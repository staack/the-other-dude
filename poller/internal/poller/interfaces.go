package poller

import (
	"context"

	"github.com/staack/the-other-dude/poller/internal/store"
)

// DeviceFetcher is the subset of store.DeviceStore that the Scheduler needs.
// Defined here (consumer-side) following Go interface best practices.
// The concrete *store.DeviceStore automatically satisfies this interface.
type DeviceFetcher interface {
	FetchDevices(ctx context.Context) ([]store.Device, error)
}

// DeviceGetter re-reads one device row.  The backup loop uses it so a
// host-key pin or rotated credentials written after the loop started are
// seen on the next tick instead of after a poller restart.
type DeviceGetter interface {
	GetDevice(ctx context.Context, deviceID string) (store.Device, error)
}

// SSHHostKeyUpdater is the subset of store.DeviceStore used by the BackupScheduler
// to persist TOFU SSH host key fingerprints after first successful connection.
type SSHHostKeyUpdater interface {
	UpdateSSHHostKey(ctx context.Context, deviceID string, fingerprint string) error
}
