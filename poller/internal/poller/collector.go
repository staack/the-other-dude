package poller

import (
	"context"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/store"
)

// Collector defines the contract for device-type-specific data collection.
// Each device type (RouterOS, SNMP) implements this interface.
// The Scheduler dispatches to the appropriate Collector based on device_type.
type Collector interface {
	// Collect performs one complete poll cycle for a device.
	// It handles lock acquisition, credential decryption, connection,
	// data collection, and event publishing.
	// Returns ErrDeviceOffline if the device cannot be reached.
	Collect(ctx context.Context, dev store.Device, pub *bus.Publisher) error
}
