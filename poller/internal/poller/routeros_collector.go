package poller

import (
	"context"
	"time"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// RouterOSCollector implements Collector for MikroTik RouterOS devices.
// It wraps the existing PollDevice logic, preserving identical behavior.
// RouterOSCollector holds no locker: the scheduler owns per-device locking for
// every collector type, which is what cec645a set out to do.
type RouterOSCollector struct {
	credentialCache *vault.CredentialCache
	connTimeout     time.Duration
	cmdTimeout      time.Duration
}

// NewRouterOSCollector creates a RouterOSCollector with the given dependencies.
func NewRouterOSCollector(
	credentialCache *vault.CredentialCache,
	connTimeout time.Duration,
	cmdTimeout time.Duration,
) *RouterOSCollector {
	return &RouterOSCollector{
		credentialCache: credentialCache,
		connTimeout:     connTimeout,
		cmdTimeout:      cmdTimeout,
	}
}

// Collect performs one RouterOS poll cycle. This is a thin wrapper around
// PollDevice -- all business logic remains in worker.go unchanged.
func (c *RouterOSCollector) Collect(ctx context.Context, dev store.Device, pub *bus.Publisher) error {
	return PollDevice(ctx, dev, pub, c.credentialCache, c.connTimeout, c.cmdTimeout)
}

// Compile-time interface assertion.
var _ Collector = (*RouterOSCollector)(nil)
