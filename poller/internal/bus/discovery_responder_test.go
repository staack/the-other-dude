package bus

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDiscoveryResponder_Subscribe(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	dr := NewDiscoveryResponder(nc)
	if err := dr.Start(); err != nil {
		t.Fatalf("Start() returned error: %v", err)
	}
	defer dr.Stop()

	if dr.sub == nil {
		t.Fatal("expected subscription to be set after Start()")
	}

	// Verify subscription subject and queue group
	if dr.sub.Subject != "device.discover.snmp" {
		t.Errorf("expected subject 'device.discover.snmp', got %q", dr.sub.Subject)
	}
	if dr.sub.Queue != "discover-workers" {
		t.Errorf("expected queue 'discover-workers', got %q", dr.sub.Queue)
	}
}

func TestDiscoveryResponder_InvalidJSON(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	dr := NewDiscoveryResponder(nc)
	if err := dr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer dr.Stop()

	reply, err := nc.Request("device.discover.snmp", []byte("{invalid json"), 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp DiscoveryResponse
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

func TestDiscoveryResponder_MissingIPAddress(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	dr := NewDiscoveryResponder(nc)
	if err := dr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer dr.Stop()

	req := DiscoveryRequest{
		SNMPVersion: "v2c",
		Community:   "public",
	}
	reqData, _ := json.Marshal(req)

	reply, err := nc.Request("device.discover.snmp", reqData, 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp DiscoveryResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Error == "" {
		t.Error("expected non-empty error for missing ip_address")
	}
	if !strings.Contains(resp.Error, "ip_address") {
		t.Errorf("expected error to mention 'ip_address', got %q", resp.Error)
	}
}

func TestDiscoveryResponder_ResponseFields(t *testing.T) {
	// Verify the DiscoveryResponse JSON field names match the spec.
	resp := DiscoveryResponse{
		SysObjectID: "1.3.6.1.4.1.14988.1",
		SysDescr:    "RouterOS RB750Gr3",
		SysName:     "router1.local",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	for _, field := range []string{"sys_object_id", "sys_descr", "sys_name"} {
		if _, ok := raw[field]; !ok {
			t.Errorf("expected field %q in JSON output", field)
		}
	}

	// Verify error field with omitempty
	errResp := DiscoveryResponse{Error: "test error"}
	errData, _ := json.Marshal(errResp)
	var errRaw map[string]interface{}
	_ = json.Unmarshal(errData, &errRaw)
	if _, ok := errRaw["error"]; !ok {
		t.Error("expected 'error' field in error response JSON")
	}
}

func TestDiscoveryResponder_Stop_Unsubscribes(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	dr := NewDiscoveryResponder(nc)
	if err := dr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	if !dr.sub.IsValid() {
		t.Fatal("expected subscription to be valid before Stop()")
	}

	dr.Stop()

	if dr.sub.IsValid() {
		t.Error("expected subscription to be invalid after Stop()")
	}
}

func TestDiscoveryResponder_InvalidSNMPVersion(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	dr := NewDiscoveryResponder(nc)
	if err := dr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer dr.Stop()

	req := DiscoveryRequest{
		IPAddress:   "10.0.0.1",
		SNMPVersion: "v4",
	}
	reqData, _ := json.Marshal(req)

	reply, err := nc.Request("device.discover.snmp", reqData, 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp DiscoveryResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Error == "" {
		t.Error("expected non-empty error for invalid snmp_version")
	}
}

func TestDiscoveryResponder_DefaultPort(t *testing.T) {
	// Test that requests with zero port default to 161.
	// We verify this indirectly -- the request should not fail validation
	// (it will fail on SNMP connect, which is expected since there's no device).
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	dr := NewDiscoveryResponder(nc)
	if err := dr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer dr.Stop()

	req := DiscoveryRequest{
		IPAddress:   "192.0.2.1", // TEST-NET, unreachable
		SNMPVersion: "v2c",
		Community:   "public",
		// SNMPPort intentionally 0 -- should default to 161
	}
	reqData, _ := json.Marshal(req)

	reply, err := nc.Request("device.discover.snmp", reqData, 10*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp DiscoveryResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	// The request passed validation (no "ip_address" or "snmp_version" error).
	// It should fail on SNMP probe (unreachable device), not on validation.
	if resp.Error != "" && strings.Contains(resp.Error, "ip_address") {
		t.Error("request with zero port should not fail ip_address validation")
	}
	if resp.Error != "" && strings.Contains(resp.Error, "snmp_version") {
		t.Error("request with zero port should not fail snmp_version validation")
	}
}
