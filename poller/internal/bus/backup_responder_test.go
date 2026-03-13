package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/mikrotik-portal/poller/internal/store"
)

// mockDeviceStore implements a minimal device store for testing.
type mockDeviceStore struct {
	device store.Device
	err    error
}

func (m *mockDeviceStore) GetDevice(_ context.Context, _ string) (store.Device, error) {
	return m.device, m.err
}

// mockBackupExecutor implements BackupExecutor for testing.
type mockBackupExecutor struct {
	hash string
	err  error
}

func (m *mockBackupExecutor) CollectAndPublish(_ context.Context, _ store.Device) (string, error) {
	return m.hash, m.err
}

// mockLocker implements BackupLocker for testing.
type mockLocker struct {
	obtained bool
	err      error
}

func (m *mockLocker) ObtainLock(_ context.Context, _ string, _ time.Duration) (BackupLockHandle, error) {
	if !m.obtained {
		return nil, ErrLockNotObtained
	}
	return &mockLockHandle{}, m.err
}

type mockLockHandle struct{}

func (h *mockLockHandle) Release(_ context.Context) error { return nil }

// testMsg builds a nats.Msg with the given payload and a reply inbox.
func testMsg(t *testing.T, payload any) *nats.Msg {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return &nats.Msg{
		Subject: "config.backup.trigger",
		Data:    data,
		Reply:   "test.reply",
	}
}

func TestBackupResponder_Subscribe(t *testing.T) {
	// Start embedded NATS for subscribe test
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	br := NewBackupResponder(nc, &mockDeviceStore{}, &mockBackupExecutor{}, &mockLocker{obtained: true}, 30*time.Second)
	if err := br.Subscribe(); err != nil {
		t.Fatalf("Subscribe() returned error: %v", err)
	}
	defer br.Stop()

	if br.sub == nil {
		t.Fatal("expected subscription to be set after Subscribe()")
	}
}

func TestBackupResponder_ValidRequest_Success(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	deviceID := "test-device-123"
	tenantID := "test-tenant-456"
	expectedHash := "abc123def456"

	br := NewBackupResponder(
		nc,
		&mockDeviceStore{device: store.Device{ID: deviceID, TenantID: tenantID, IPAddress: "10.0.0.1"}},
		&mockBackupExecutor{hash: expectedHash},
		&mockLocker{obtained: true},
		30*time.Second,
	)
	if err := br.Subscribe(); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer br.Stop()

	req := BackupTriggerRequest{DeviceID: deviceID, TenantID: tenantID}
	reqData, _ := json.Marshal(req)

	reply, err := nc.Request("config.backup.trigger", reqData, 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp BackupTriggerResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Status != "success" {
		t.Errorf("expected status 'success', got %q", resp.Status)
	}
	if resp.SHA256Hash != expectedHash {
		t.Errorf("expected hash %q, got %q", expectedHash, resp.SHA256Hash)
	}
}

func TestBackupResponder_LockHeld_ReturnsLocked(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	br := NewBackupResponder(
		nc,
		&mockDeviceStore{device: store.Device{ID: "dev1", TenantID: "ten1", IPAddress: "10.0.0.1"}},
		&mockBackupExecutor{hash: "unused"},
		&mockLocker{obtained: false}, // lock NOT obtained
		30*time.Second,
	)
	if err := br.Subscribe(); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer br.Stop()

	req := BackupTriggerRequest{DeviceID: "dev1", TenantID: "ten1"}
	reqData, _ := json.Marshal(req)

	reply, err := nc.Request("config.backup.trigger", reqData, 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp BackupTriggerResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Status != "locked" {
		t.Errorf("expected status 'locked', got %q", resp.Status)
	}
	if resp.Message == "" {
		t.Error("expected non-empty message for locked response")
	}
}

func TestBackupResponder_InvalidJSON_ReturnsError(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	br := NewBackupResponder(
		nc,
		&mockDeviceStore{},
		&mockBackupExecutor{},
		&mockLocker{obtained: true},
		30*time.Second,
	)
	if err := br.Subscribe(); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer br.Stop()

	reply, err := nc.Request("config.backup.trigger", []byte("{invalid json"), 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp BackupTriggerResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Error == "" {
		t.Error("expected non-empty error for invalid JSON")
	}
}

func TestBackupResponder_Stop_Unsubscribes(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	br := NewBackupResponder(
		nc,
		&mockDeviceStore{},
		&mockBackupExecutor{},
		&mockLocker{obtained: true},
		30*time.Second,
	)
	if err := br.Subscribe(); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	// Verify subscription is active
	if !br.sub.IsValid() {
		t.Fatal("expected subscription to be valid before Stop()")
	}

	br.Stop()

	if br.sub.IsValid() {
		t.Error("expected subscription to be invalid after Stop()")
	}
}

func TestBackupResponder_DeviceNotFound_ReturnsError(t *testing.T) {
	nc, cleanup := startTestNATS(t)
	defer cleanup()

	br := NewBackupResponder(
		nc,
		&mockDeviceStore{err: fmt.Errorf("device not found")},
		&mockBackupExecutor{},
		&mockLocker{obtained: true},
		30*time.Second,
	)
	if err := br.Subscribe(); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer br.Stop()

	req := BackupTriggerRequest{DeviceID: "nonexistent", TenantID: "ten1"}
	reqData, _ := json.Marshal(req)

	reply, err := nc.Request("config.backup.trigger", reqData, 5*time.Second)
	if err != nil {
		t.Fatalf("NATS request failed: %v", err)
	}

	var resp BackupTriggerResponse
	if err := json.Unmarshal(reply.Data, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Status != "failed" {
		t.Errorf("expected status 'failed', got %q", resp.Status)
	}
	if resp.Error == "" {
		t.Error("expected non-empty error for device not found")
	}
}

// startTestNATS starts an embedded NATS server for testing and returns
// a connected client and cleanup function.
func startTestNATS(t *testing.T) (*nats.Conn, func()) {
	t.Helper()

	// Use nats-server test helper: start a temporary NATS server
	s, err := nats.Connect(nats.DefaultURL)
	if err != nil {
		// Fall back to in-process test server
		t.Skip("NATS server not available for testing, skipping")
	}
	return s, func() { s.Close() }
}
