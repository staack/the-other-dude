package poller

import (
	"context"
	"errors"
	"testing"

	"github.com/staack/the-other-dude/poller/internal/device"
	"github.com/staack/the-other-dude/poller/internal/store"
)

type fakeDeviceGetter struct {
	dev store.Device
	err error
}

func (f fakeDeviceGetter) GetDevice(ctx context.Context, id string) (store.Device, error) {
	if f.err != nil {
		return store.Device{}, f.err
	}
	return f.dev, nil
}

// The backup loop was built on a one-time snapshot of the device row, so a
// host-key pin written to the database (or rotated credentials) never reached
// a running loop until the poller restarted.  Each tick now re-reads the row.
func TestRefreshDevice_UsesCurrentRow(t *testing.T) {
	pin := "SHA256:pinned"
	creds := "new-ciphertext"
	bs := &BackupScheduler{devices: fakeDeviceGetter{dev: store.Device{
		ID: "dev-1", SSHHostKeyFingerprint: &pin, EncryptedCredentialsTransit: &creds,
	}}}
	old := "old-ciphertext"
	stale := store.Device{ID: "dev-1", EncryptedCredentialsTransit: &old}

	fresh := bs.refreshDevice(context.Background(), stale, &backupDeviceState{})

	if fresh.SSHHostKeyFingerprint == nil || *fresh.SSHHostKeyFingerprint != pin {
		t.Fatalf("pin not refreshed: %#v", fresh.SSHHostKeyFingerprint)
	}
	if fresh.EncryptedCredentialsTransit == nil || *fresh.EncryptedCredentialsTransit != "new-ciphertext" {
		t.Fatalf("credentials not refreshed: %v", fresh.EncryptedCredentialsTransit)
	}
}

func TestRefreshDevice_KeepsSnapshotWhenLookupFails(t *testing.T) {
	bs := &BackupScheduler{devices: fakeDeviceGetter{err: errors.New("db down")}}
	stale := store.Device{ID: "dev-1", IPAddress: "10.0.0.1"}

	fresh := bs.refreshDevice(context.Background(), stale, &backupDeviceState{})

	if fresh.IPAddress != "10.0.0.1" {
		t.Fatalf("snapshot lost on lookup failure: %#v", fresh)
	}
}

// A pin written by this loop earlier must survive a failed row refresh;
// otherwise the next run would accept any host key again.
func TestRefreshDevice_KeepsOwnPinWhenLookupFails(t *testing.T) {
	bs := &BackupScheduler{devices: fakeDeviceGetter{err: errors.New("db down")}}
	stale := store.Device{ID: "dev-1"} // snapshot from before the first connect
	state := &backupDeviceState{pinnedFingerprint: "SHA256:written-last-run"}

	fresh := bs.refreshDevice(context.Background(), stale, state)

	if fresh.SSHHostKeyFingerprint == nil || *fresh.SSHHostKeyFingerprint != "SHA256:written-last-run" {
		t.Fatalf("pin forgotten on lookup failure: %#v", fresh.SSHHostKeyFingerprint)
	}
}

// An authoritative refresh is the source of truth for the pin: if an
// operator cleared it in the database, the loop must not keep re-applying
// the one it remembers (that would block a replaced device forever).
func TestRefreshDevice_SyncsRememberedPinWithFreshRow(t *testing.T) {
	bs := &BackupScheduler{devices: fakeDeviceGetter{dev: store.Device{ID: "dev-1"}}} // pin cleared in DB
	state := &backupDeviceState{pinnedFingerprint: "SHA256:old"}

	fresh := bs.refreshDevice(context.Background(), store.Device{ID: "dev-1"}, state)

	if fresh.SSHHostKeyFingerprint != nil {
		t.Fatalf("cleared pin re-applied from memory: %v", *fresh.SSHHostKeyFingerprint)
	}
	if state.pinnedFingerprint != "" {
		t.Fatalf("remembered pin not cleared after an authoritative refresh: %q", state.pinnedFingerprint)
	}
}

// Only a conflicting pin is a host-key failure (which blocks retries); a
// database outage during the write must stay retryable.
func TestPinWriteError_OnlyConflictBlocksRetries(t *testing.T) {
	conflict := pinWriteError("dev-1", store.ErrHostKeyConflict)
	var sshErr *device.SSHError
	if !errors.As(conflict, &sshErr) || sshErr.Kind != device.ErrHostKeyMismatch {
		t.Fatalf("conflict not mapped to a host-key mismatch: %v", conflict)
	}
	transient := pinWriteError("dev-1", errors.New("connection refused"))
	if errors.As(transient, &sshErr) {
		t.Fatalf("transient storage error mapped to a blocking SSH error: %v", transient)
	}
	if transient == nil {
		t.Fatal("transient error must still fail this run")
	}
}
