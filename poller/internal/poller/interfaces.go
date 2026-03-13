package poller

import (
	"context"

	"github.com/mikrotik-portal/poller/internal/store"
)

// DeviceFetcher is the subset of store.DeviceStore that the Scheduler needs.
// Defined here (consumer-side) following Go interface best practices.
// The concrete *store.DeviceStore automatically satisfies this interface.
type DeviceFetcher interface {
	FetchDevices(ctx context.Context) ([]store.Device, error)
}

// SSHHostKeyUpdater is the subset of store.DeviceStore used by the BackupScheduler
// to persist TOFU SSH host key fingerprints after first successful connection.
type SSHHostKeyUpdater interface {
	UpdateSSHHostKey(ctx context.Context, deviceID string, fingerprint string) error
}
