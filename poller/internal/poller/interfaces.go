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
