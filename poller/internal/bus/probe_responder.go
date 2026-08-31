// Package bus provides NATS messaging for the poller service.
//
// probe_responder.go implements a NATS request-reply handler for live RouterOS
// connectivity probes. The backend sends a request to "device.probe.routeros"
// with connection parameters and receives a staged, classified result.
//
// The probe deliberately lives here rather than in the Python backend: the
// failure it exists to catch is a property of Go's crypto/tls, which implements
// no anonymous cipher suites. Python's OpenSSL bindings negotiate anonymous-DH
// happily, so a backend-side TLS probe would pronounce a device healthy that
// the Go poller can never talk to. Probing from the poller means the check and
// the poll share one implementation and cannot disagree.
//
// Credentials arrive in the request rather than being looked up, because
// onboarding validates a device that does not exist in the database yet. This
// mirrors DiscoveryResponder (device.discover.snmp).

package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/staack/the-other-dude/poller/internal/device"
	"github.com/staack/the-other-dude/poller/internal/store"
)

// Probe defaults, applied when the caller omits a field.
const (
	defaultProbeSSLPort   = 8729
	defaultProbePlainPort = 8728
	defaultProbeTLSMode   = "auto"
	defaultProbeTimeout   = 10 * time.Second
	maxProbeTimeout       = 30 * time.Second
)

// ProbeRequest is the JSON payload sent by the backend to probe a device.
// Credentials come directly in the request: at onboarding time the device is
// not yet stored, so there is nothing to look up.
type ProbeRequest struct {
	IPAddress      string `json:"ip_address"`
	APIPort        int    `json:"api_port,omitempty"`
	APISSLPort     int    `json:"api_ssl_port,omitempty"`
	Username       string `json:"username"`
	Password       string `json:"password"`
	TLSMode        string `json:"tls_mode,omitempty"`
	CACertPEM      string `json:"ca_cert_pem,omitempty"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
}

// ProbeResponse carries the probe result back to the backend. Error is set only
// for malformed requests; a device that simply cannot be reached is a
// successful response with OK=false and a classified Reason.
type ProbeResponse struct {
	device.ProbeResult
	Error string `json:"error,omitempty"`
}

// ProbeCredentialResolver is the subset of vault.CredentialCache needed to
// probe a stored device. It matches the call the poll path makes
// (poller/internal/poller/worker.go:113), so the probe resolves credentials
// exactly as polling does.
type ProbeCredentialResolver interface {
	GetCredentials(
		deviceID, tenantID string,
		transitCiphertext *string, legacyCiphertext []byte,
		profileTransitCiphertext *string, profileLegacyCiphertext []byte,
	) (string, string, error)
}

// ProbeResponder handles NATS request-reply for RouterOS connectivity probes.
//
// It serves two subjects:
//
//   - "device.probe.routeros" -- ad-hoc: all parameters in the request, for
//     onboarding validation, when the device is not in the database yet.
//   - "device.probe.stored.{device_id}" -- stored: settings and credentials
//     read from the database, for the test-connection endpoint.
//
// The subjects are deliberately different lengths. A single "device.probe.*"
// wildcard would also match "device.probe.routeros" and the two handlers would
// answer each other's requests.
type ProbeResponder struct {
	nc  *nats.Conn
	sub *nats.Subscription

	deviceStore ProbeDeviceGetter
	credentials ProbeCredentialResolver
	storedSub   *nats.Subscription
}

// ProbeDeviceGetter is the subset of store.DeviceStore needed by the
// stored-device probe.
type ProbeDeviceGetter interface {
	GetDevice(ctx context.Context, deviceID string) (store.Device, error)
}

// NewProbeResponder creates a probe responder that serves ad-hoc probes.
// Parameters come in the request, so no store is required.
func NewProbeResponder(nc *nats.Conn) *ProbeResponder {
	return &ProbeResponder{nc: nc}
}

// WithStore additionally enables the stored-device probe subject. Without it,
// only ad-hoc probes are served.
func (r *ProbeResponder) WithStore(s ProbeDeviceGetter, creds ProbeCredentialResolver) *ProbeResponder {
	r.deviceStore = s
	r.credentials = creds
	return r
}

// Start subscribes to the probe subjects with a queue group for load balancing
// across multiple poller instances.
func (r *ProbeResponder) Start() error {
	sub, err := r.nc.QueueSubscribe("device.probe.routeros", "probe-workers", r.handleRequest)
	if err != nil {
		return fmt.Errorf("subscribing to device.probe.routeros: %w", err)
	}
	r.sub = sub
	slog.Info("probe responder subscribed", "subject", "device.probe.routeros", "queue", "probe-workers")

	if r.deviceStore == nil || r.credentials == nil {
		return nil
	}

	storedSub, err := r.nc.QueueSubscribe("device.probe.stored.*", "probe-workers", r.handleStoredRequest)
	if err != nil {
		return fmt.Errorf("subscribing to device.probe.stored.*: %w", err)
	}
	r.storedSub = storedSub
	slog.Info("probe responder subscribed", "subject", "device.probe.stored.*", "queue", "probe-workers")
	return nil
}

// Stop unsubscribes from NATS.
func (r *ProbeResponder) Stop() {
	for _, sub := range []*nats.Subscription{r.sub, r.storedSub} {
		if sub == nil {
			continue
		}
		if err := sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing probe responder", "subject", sub.Subject, "error", err)
		}
	}
}

// handleStoredRequest probes a device that already exists in the database,
// using its stored connection settings and credentials. This is what makes a
// test-connection call a faithful rehearsal of the next poll.
func (r *ProbeResponder) handleStoredRequest(msg *nats.Msg) {
	parts := strings.Split(msg.Subject, ".")
	if len(parts) < 4 {
		r.respond(msg, ProbeResponse{Error: "invalid subject format"})
		return
	}
	deviceID := parts[3]

	// The body is optional; it may carry a timeout override.
	var req ProbeRequest
	if len(msg.Data) > 0 {
		if err := json.Unmarshal(msg.Data, &req); err != nil {
			r.respond(msg, ProbeResponse{Error: fmt.Sprintf("invalid request: %s", err)})
			return
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dev, err := r.deviceStore.GetDevice(ctx, deviceID)
	if err != nil {
		r.respond(msg, ProbeResponse{Error: fmt.Sprintf("device not found: %s", err)})
		return
	}

	if dev.DeviceType == "snmp" {
		r.respond(msg, ProbeResponse{Error: "test-connection is only supported for RouterOS devices"})
		return
	}

	username, password, err := r.credentials.GetCredentials(
		dev.ID,
		dev.TenantID,
		dev.EncryptedCredentialsTransit,
		dev.EncryptedCredentials,
		dev.ProfileEncryptedCredentialsTransit,
		dev.ProfileEncryptedCredentials,
	)
	if err != nil {
		// Reported as a transport error, not a probe failure: probing with
		// empty credentials would masquerade as an authentication failure.
		r.respond(msg, ProbeResponse{Error: fmt.Sprintf("credential decryption failed: %s", err)})
		return
	}

	var caCertPEM []byte
	if dev.CACertPEM != nil {
		caCertPEM = []byte(*dev.CACertPEM)
	}

	timeout := defaultProbeTimeout
	if req.TimeoutSeconds > 0 {
		timeout = time.Duration(req.TimeoutSeconds) * time.Second
		if timeout > maxProbeTimeout {
			timeout = maxProbeTimeout
		}
	}

	slog.Info("stored device probe starting",
		"device_id", deviceID, "ip", dev.IPAddress, "tls_mode", dev.TLSMode)

	result := device.ProbeRouterOS(
		dev.IPAddress,
		dev.APISSLPort,
		dev.APIPort,
		username,
		password,
		timeout,
		caCertPEM,
		dev.TLSMode,
	)

	slog.Info("stored device probe complete",
		"device_id", deviceID, "ok", result.OK,
		"stage", result.Stage, "reason", result.Reason,
		"elapsed_ms", result.ElapsedMS)

	r.respond(msg, ProbeResponse{ProbeResult: result})
}

// handleRequest runs a single connectivity probe.
func (r *ProbeResponder) handleRequest(msg *nats.Msg) {
	var req ProbeRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		r.respond(msg, ProbeResponse{Error: fmt.Sprintf("invalid request: %s", err)})
		return
	}

	if req.IPAddress == "" {
		r.respond(msg, ProbeResponse{Error: "ip_address is required"})
		return
	}

	// Apply defaults.
	if req.APISSLPort == 0 {
		req.APISSLPort = defaultProbeSSLPort
	}
	if req.APIPort == 0 {
		req.APIPort = defaultProbePlainPort
	}
	if req.TLSMode == "" {
		req.TLSMode = defaultProbeTLSMode
	}

	timeout := defaultProbeTimeout
	if req.TimeoutSeconds > 0 {
		timeout = time.Duration(req.TimeoutSeconds) * time.Second
		if timeout > maxProbeTimeout {
			timeout = maxProbeTimeout
		}
	}

	var caCertPEM []byte
	if req.CACertPEM != "" {
		caCertPEM = []byte(req.CACertPEM)
	}

	slog.Info("device probe starting",
		"ip", req.IPAddress, "tls_mode", req.TLSMode,
		"ssl_port", req.APISSLPort, "plain_port", req.APIPort)

	result := device.ProbeRouterOS(
		req.IPAddress,
		req.APISSLPort,
		req.APIPort,
		req.Username,
		req.Password,
		timeout,
		caCertPEM,
		req.TLSMode,
	)

	slog.Info("device probe complete",
		"ip", req.IPAddress, "ok", result.OK,
		"stage", result.Stage, "reason", result.Reason,
		"elapsed_ms", result.ElapsedMS)

	r.respond(msg, ProbeResponse{ProbeResult: result})
}

// respond sends a JSON-encoded ProbeResponse to a NATS request.
func (r *ProbeResponder) respond(msg *nats.Msg, resp ProbeResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		slog.Error("failed to marshal probe response", "error", err)
		return
	}
	if err := msg.Respond(data); err != nil {
		slog.Error("failed to respond to probe request", "error", err)
	}
}
