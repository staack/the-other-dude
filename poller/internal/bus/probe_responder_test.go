package bus

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/staack/the-other-dude/poller/internal/device"
	"github.com/staack/the-other-dude/poller/internal/store"
)

func TestProbeResponder_Subscribe(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	pr := NewProbeResponder(nc)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start() returned error: %v", err)
	}
	defer pr.Stop()

	if pr.sub == nil {
		t.Fatal("expected subscription to be set after Start()")
	}
	if pr.sub.Subject != "device.probe.routeros" {
		t.Errorf("expected subject 'device.probe.routeros', got %q", pr.sub.Subject)
	}
	if pr.sub.Queue != "probe-workers" {
		t.Errorf("expected queue 'probe-workers', got %q", pr.sub.Queue)
	}
}

func TestProbeResponder_InvalidJSON(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	pr := NewProbeResponder(nc)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	reply, err := nc.Request("device.probe.routeros", []byte("{invalid json"), 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Error == "" {
		t.Error("expected non-empty error for invalid JSON")
	}
	if !strings.Contains(resp.Error, "invalid request") {
		t.Errorf("expected error to contain 'invalid request', got %q", resp.Error)
	}
}

func TestProbeResponder_MissingIPAddress(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	pr := NewProbeResponder(nc)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	reqData, _ := json.Marshal(ProbeRequest{Username: "admin", Password: "pw"})
	reply, err := nc.Request("device.probe.routeros", reqData, 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !strings.Contains(resp.Error, "ip_address") {
		t.Errorf("expected error naming ip_address, got %q", resp.Error)
	}
}

// TestProbeResponder_ClosedPortRoundTrip proves the full request-reply contract:
// the responder runs a real probe and returns a structured, classified result
// rather than a bare boolean.
func TestProbeResponder_ClosedPortRoundTrip(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	pr := NewProbeResponder(nc)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	port := closedPort(t)
	reqData, _ := json.Marshal(ProbeRequest{
		IPAddress:      "127.0.0.1",
		APIPort:        port,
		APISSLPort:     port,
		Username:       "admin",
		Password:       "pw",
		TLSMode:        "insecure",
		TimeoutSeconds: 3,
	})

	reply, err := nc.Request("device.probe.routeros", reqData, 10*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Error != "" {
		t.Fatalf("unexpected transport error: %s", resp.Error)
	}
	if resp.OK {
		t.Error("expected ok=false against a closed port")
	}
	if resp.Reason != device.ReasonUnreachable {
		t.Errorf("expected reason %q, got %q", device.ReasonUnreachable, resp.Reason)
	}
	if resp.Message == "" {
		t.Error("expected a human-readable message")
	}
}

// TestProbeResponder_DefaultsAreApplied confirms a caller may omit ports and
// timeout and still get a usable probe.
func TestProbeResponder_DefaultsAreApplied(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	pr := NewProbeResponder(nc)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	// No ports, no tls_mode, no timeout: defaults must fill in 8729/8728/auto.
	reqData, _ := json.Marshal(ProbeRequest{
		IPAddress: "127.0.0.1",
		Username:  "admin",
		Password:  "pw",
	})

	reply, err := nc.Request("device.probe.routeros", reqData, 20*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Error != "" {
		t.Fatalf("unexpected transport error: %s", resp.Error)
	}
	if resp.TLSMode != "auto" {
		t.Errorf("expected tls_mode to default to 'auto', got %q", resp.TLSMode)
	}
	// Nothing is listening on 8729 of the test host, so this must be a
	// classified failure rather than a crash or an empty response.
	if resp.Reason == "" {
		t.Error("expected a classified reason")
	}
}

// closedPort reserves an ephemeral port and immediately releases it.
func closedPort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserving port: %v", err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	if err := l.Close(); err != nil {
		t.Fatalf("releasing port: %v", err)
	}
	return port
}

// --- stored-device probe (device.probe.stored.{device_id}) --------------------

// mockCredentialResolver stands in for vault.CredentialCache.
type mockCredentialResolver struct {
	username string
	password string
	err      error

	gotProfileTransit *string
	gotProfileLegacy  []byte
}

func (m *mockCredentialResolver) GetCredentials(
	_, _ string, _ *string, _ []byte,
	profileTransitCiphertext *string, profileLegacyCiphertext []byte,
) (string, string, error) {
	m.gotProfileTransit = profileTransitCiphertext
	m.gotProfileLegacy = profileLegacyCiphertext
	return m.username, m.password, m.err
}

func TestProbeResponder_StoredSubscribe(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	pr := NewProbeResponder(nc).WithStore(&mockDeviceStore{}, &mockCredentialResolver{})
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	if pr.storedSub == nil {
		t.Fatal("expected stored-device subscription after Start()")
	}
	if pr.storedSub.Subject != "device.probe.stored.*" {
		t.Errorf("expected subject 'device.probe.stored.*', got %q", pr.storedSub.Subject)
	}
	// The two subjects must not overlap, or one responder would answer the
	// other's requests: "device.probe.*" would swallow "device.probe.routeros".
	if pr.sub.Subject == pr.storedSub.Subject {
		t.Error("ad-hoc and stored-device subjects must be distinct")
	}
}

// TestProbeResponder_StoredDeviceUsesStoredSettings proves the stored-device
// probe reads connection settings from the database rather than the request, so
// a test-connection call exercises exactly what the poller will do.
func TestProbeResponder_StoredDeviceUsesStoredSettings(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	port := closedPort(t)
	store := &mockDeviceStore{device: storeDevice("dev-1", "tenant-1", "127.0.0.1", port, port, "insecure")}
	creds := &mockCredentialResolver{username: "stored-user", password: "stored-pass"}

	pr := NewProbeResponder(nc).WithStore(store, creds)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	reply, err := nc.Request("device.probe.stored.dev-1", []byte("{}"), 10*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Error != "" {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
	if resp.TLSMode != "insecure" {
		t.Errorf("expected the stored tls_mode 'insecure', got %q", resp.TLSMode)
	}
	if resp.Reason != device.ReasonUnreachable {
		t.Errorf("expected reason %q against a closed stored port, got %q", device.ReasonUnreachable, resp.Reason)
	}
}

func TestProbeResponder_StoredDeviceNotFound(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	store := &mockDeviceStore{err: errNotFound}
	pr := NewProbeResponder(nc).WithStore(store, &mockCredentialResolver{})
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	reply, err := nc.Request("device.probe.stored.missing", []byte("{}"), 10*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Error == "" {
		t.Error("expected an error for an unknown device")
	}
}

// TestProbeResponder_StoredDeviceCredentialFailure ensures a decryption failure
// is reported as such, not silently probed with empty credentials -- which
// would surface as a misleading "authentication failed".
func TestProbeResponder_StoredDeviceCredentialFailure(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	port := closedPort(t)
	store := &mockDeviceStore{device: storeDevice("dev-1", "tenant-1", "127.0.0.1", port, port, "auto")}
	creds := &mockCredentialResolver{err: errNotFound}

	pr := NewProbeResponder(nc).WithStore(store, creds)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	reply, err := nc.Request("device.probe.stored.dev-1", []byte("{}"), 10*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp ProbeResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Error == "" {
		t.Error("expected a credential decryption error to be reported")
	}
	if !strings.Contains(strings.ToLower(resp.Error), "credential") {
		t.Errorf("expected the error to name credentials, got %q", resp.Error)
	}
}

var errNotFound = fmt.Errorf("device not found")

// storeDevice builds a minimal store.Device for probe tests.
func storeDevice(id, tenantID, ip string, sslPort, plainPort int, tlsMode string) store.Device {
	return store.Device{
		ID:         id,
		TenantID:   tenantID,
		IPAddress:  ip,
		APISSLPort: sslPort,
		APIPort:    plainPort,
		TLSMode:    tlsMode,
		DeviceType: "routeros",
	}
}

// A device whose credentials live only on a credential profile must still probe:
// the resolver needs the profile ciphertexts, not just the device's own.
func TestProbeResponder_StoredDeviceForwardsProfileCredentials(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	port := closedPort(t)
	dev := storeDevice("dev-1", "tenant-1", "127.0.0.1", port, port, "insecure")
	profileTransit := "vault:v1:profile-ciphertext"
	dev.ProfileEncryptedCredentialsTransit = &profileTransit
	dev.ProfileEncryptedCredentials = []byte("legacy-profile-blob")

	creds := &mockCredentialResolver{username: "u", password: "p"}
	pr := NewProbeResponder(nc).WithStore(&mockDeviceStore{device: dev}, creds)
	if err := pr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer pr.Stop()

	if _, err := nc.Request("device.probe.stored.dev-1", []byte("{}"), 10*time.Second); err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	if creds.gotProfileTransit == nil {
		t.Fatal("profile transit ciphertext was not forwarded to the credential resolver")
	}
	if *creds.gotProfileTransit != profileTransit {
		t.Errorf("profile transit ciphertext = %q, want %q", *creds.gotProfileTransit, profileTransit)
	}
	if string(creds.gotProfileLegacy) != "legacy-profile-blob" {
		t.Errorf("profile legacy ciphertext = %q, want %q", creds.gotProfileLegacy, "legacy-profile-blob")
	}
}
