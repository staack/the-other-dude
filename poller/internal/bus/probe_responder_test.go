package bus

import (
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/staack/the-other-dude/poller/internal/device"
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
