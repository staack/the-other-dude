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
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/staack/the-other-dude/poller/internal/device"
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

// ProbeResponder handles NATS request-reply for RouterOS connectivity probes.
type ProbeResponder struct {
	nc  *nats.Conn
	sub *nats.Subscription
}

// NewProbeResponder creates a probe responder using the given NATS connection.
// No store or credential cache is needed -- parameters come in the request.
func NewProbeResponder(nc *nats.Conn) *ProbeResponder {
	return &ProbeResponder{nc: nc}
}

// Start subscribes to "device.probe.routeros" with a queue group for load
// balancing across multiple poller instances.
func (r *ProbeResponder) Start() error {
	sub, err := r.nc.QueueSubscribe("device.probe.routeros", "probe-workers", r.handleRequest)
	if err != nil {
		return fmt.Errorf("subscribing to device.probe.routeros: %w", err)
	}
	r.sub = sub
	slog.Info("probe responder subscribed", "subject", "device.probe.routeros", "queue", "probe-workers")
	return nil
}

// Stop unsubscribes from NATS.
func (r *ProbeResponder) Stop() {
	if r.sub != nil {
		if err := r.sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing probe responder", "error", err)
		}
	}
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
