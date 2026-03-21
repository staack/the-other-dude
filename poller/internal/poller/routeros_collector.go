package poller

import (
	"context"
	"time"

	"github.com/bsm/redislock"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// RouterOSCollector implements Collector for MikroTik RouterOS devices.
// It wraps the existing PollDevice logic, preserving identical behavior.
type RouterOSCollector struct {
	locker          *redislock.Client
	credentialCache *vault.CredentialCache
	connTimeout     time.Duration
	cmdTimeout      time.Duration
	lockTTL         time.Duration
}

// NewRouterOSCollector creates a RouterOSCollector with the given dependencies.
func NewRouterOSCollector(
	locker *redislock.Client,
	credentialCache *vault.CredentialCache,
	connTimeout time.Duration,
	cmdTimeout time.Duration,
	lockTTL time.Duration,
) *RouterOSCollector {
	return &RouterOSCollector{
		locker:          locker,
		credentialCache: credentialCache,
		connTimeout:     connTimeout,
		cmdTimeout:      cmdTimeout,
		lockTTL:         lockTTL,
	}
}

// Collect performs one RouterOS poll cycle. This is a thin wrapper around
// PollDevice -- all business logic remains in worker.go unchanged.
func (c *RouterOSCollector) Collect(ctx context.Context, dev store.Device, pub *bus.Publisher) error {
	return PollDevice(ctx, dev, c.locker, pub, c.credentialCache, c.connTimeout, c.cmdTimeout, c.lockTTL)
}

// Compile-time interface assertion.
var _ Collector = (*RouterOSCollector)(nil)
