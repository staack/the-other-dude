package poller

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/bsm/redislock"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/observability"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// deviceState tracks per-device circuit breaker and lifecycle state.
type deviceState struct {
	cancel              context.CancelFunc
	consecutiveFailures int
	backoffUntil        time.Time
}

// Scheduler manages the lifecycle of per-device polling goroutines.
//
// It periodically re-queries the database to discover new devices (starting goroutines)
// and detect removed devices (stopping goroutines). Each device has exactly one
// polling goroutine running at a time.
//
// Circuit breaker: after consecutive connection failures, a device enters exponential
// backoff. The device loop skips poll ticks during backoff. On successful poll, the
// circuit breaker resets and the device resumes normal polling.
type Scheduler struct {
	store           DeviceFetcher
	locker          *redislock.Client
	publisher       *bus.Publisher
	credentialCache *vault.CredentialCache
	pollInterval    time.Duration
	connTimeout     time.Duration
	cmdTimeout      time.Duration
	refreshPeriod   time.Duration

	// Circuit breaker configuration.
	maxFailures int
	baseBackoff time.Duration
	maxBackoff  time.Duration

	// collectors maps device type name to its Collector implementation.
	// "routeros" -> RouterOSCollector, "snmp" -> SNMPCollector (future).
	collectors map[string]Collector

	// activeDevices maps device ID to per-device state.
	mu            sync.Mutex
	activeDevices map[string]*deviceState
}

// NewScheduler creates a Scheduler with the provided dependencies.
func NewScheduler(
	store DeviceFetcher,
	locker *redislock.Client,
	publisher *bus.Publisher,
	credentialCache *vault.CredentialCache,
	pollInterval time.Duration,
	connTimeout time.Duration,
	cmdTimeout time.Duration,
	refreshPeriod time.Duration,
	maxFailures int,
	baseBackoff time.Duration,
	maxBackoff time.Duration,
) *Scheduler {
	// lockTTL gives the poll cycle time to complete: interval + connection timeout + 15s margin.
	lockTTL := pollInterval + connTimeout + 15*time.Second

	s := &Scheduler{
		store:           store,
		locker:          locker,
		publisher:       publisher,
		credentialCache: credentialCache,
		pollInterval:    pollInterval,
		connTimeout:     connTimeout,
		cmdTimeout:      cmdTimeout,
		refreshPeriod:   refreshPeriod,
		maxFailures:     maxFailures,
		baseBackoff:     baseBackoff,
		maxBackoff:      maxBackoff,
		collectors:      make(map[string]Collector),
		activeDevices:   make(map[string]*deviceState),
	}

	// Register built-in collectors.
	s.collectors["routeros"] = NewRouterOSCollector(locker, credentialCache, connTimeout, cmdTimeout, lockTTL)

	return s
}

// RegisterCollector adds a named Collector to the scheduler's dispatch map.
// This allows external packages (e.g., SNMP) to register collectors without
// modifying NewScheduler's parameter list.
func (s *Scheduler) RegisterCollector(name string, c Collector) {
	s.collectors[name] = c
}

// Run is the main scheduler loop. It:
//  1. Fetches devices from the database.
//  2. Starts goroutines for newly-discovered devices.
//  3. Stops goroutines for devices no longer in the database.
//  4. Sleeps for refreshPeriod, then repeats.
//  5. Cancels all goroutines when ctx is cancelled (graceful shutdown).
//
// Run blocks until ctx is cancelled, then waits for all goroutines to finish.
func (s *Scheduler) Run(ctx context.Context) error {
	var wg sync.WaitGroup

	defer func() {
		// On shutdown, cancel all active device goroutines and wait for them.
		s.mu.Lock()
		for id, ds := range s.activeDevices {
			slog.Info("stopping device goroutine", "device_id", id)
			ds.cancel()
		}
		s.mu.Unlock()
		wg.Wait()
		slog.Info("scheduler shutdown complete")
	}()

	for {
		if err := s.reconcileDevices(ctx, &wg); err != nil {
			slog.Error("device reconciliation failed", "error", err)
			// Continue — a transient DB error should not crash the scheduler.
		}

		select {
		case <-ctx.Done():
			slog.Info("scheduler context cancelled — shutting down")
			return nil
		case <-time.After(s.refreshPeriod):
			// Next reconciliation cycle.
		}
	}
}

// reconcileDevices fetches the current device list from the DB and starts/stops
// goroutines as needed to keep the active set in sync.
func (s *Scheduler) reconcileDevices(ctx context.Context, wg *sync.WaitGroup) error {
	devices, err := s.store.FetchDevices(ctx)
	if err != nil {
		return err
	}

	// Build a set of current device IDs for quick lookup.
	currentIDs := make(map[string]struct{}, len(devices))
	for _, d := range devices {
		currentIDs[d.ID] = struct{}{}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Start goroutines for newly-discovered devices.
	for _, dev := range devices {
		if _, active := s.activeDevices[dev.ID]; !active {
			devCopy := dev // capture loop variable
			devCtx, cancel := context.WithCancel(ctx)
			ds := &deviceState{cancel: cancel}
			s.activeDevices[dev.ID] = ds

			wg.Add(1)
			go func() {
				defer wg.Done()
				s.runDeviceLoop(devCtx, devCopy, ds)
			}()

			slog.Info("started polling goroutine", "device_id", dev.ID, "ip", dev.IPAddress)
		}
	}

	// Stop goroutines for devices that are no longer in the database.
	for id, ds := range s.activeDevices {
		if _, exists := currentIDs[id]; !exists {
			slog.Info("stopping goroutine for removed device", "device_id", id)
			ds.cancel()
			delete(s.activeDevices, id)
		}
	}

	// Update Prometheus gauge with current active device count.
	observability.DevicesActive.Set(float64(len(s.activeDevices)))

	slog.Debug("device reconciliation complete",
		"total_devices", len(devices),
		"active_goroutines", len(s.activeDevices),
	)

	return nil
}

// runDeviceLoop is the per-device polling loop. It ticks at pollInterval and
// dispatches to the appropriate Collector synchronously on each tick (not in a
// sub-goroutine, to avoid unbounded goroutine growth if polls are slow).
//
// Circuit breaker: when consecutive failures exceed maxFailures, the device enters
// exponential backoff. Poll ticks during backoff are skipped. On success, the
// circuit breaker resets.
func (s *Scheduler) runDeviceLoop(ctx context.Context, dev store.Device, ds *deviceState) {
	ticker := time.NewTicker(s.pollInterval)
	defer ticker.Stop()

	slog.Debug("device poll loop started", "device_id", dev.ID, "poll_interval", s.pollInterval)

	for {
		select {
		case <-ctx.Done():
			slog.Debug("device poll loop stopping", "device_id", dev.ID)
			return

		case <-ticker.C:
			// Circuit breaker: skip poll if device is in backoff period.
			if time.Now().Before(ds.backoffUntil) {
				slog.Debug("circuit breaker: skipping poll (in backoff)",
					"device_id", dev.ID,
					"backoff_until", ds.backoffUntil.Format(time.RFC3339),
					"consecutive_failures", ds.consecutiveFailures,
				)
				observability.CircuitBreakerSkips.Inc()
				continue
			}

			// Look up collector for this device type.
			deviceType := dev.DeviceType
			if deviceType == "" {
				deviceType = "routeros" // backward compat default
			}

			collector, ok := s.collectors[deviceType]
			if !ok {
				slog.Error("no collector registered for device type",
					"device_id", dev.ID,
					"device_type", deviceType,
				)
				return // skip this device -- no collector available
			}

			err := collector.Collect(ctx, dev, s.publisher)

			if err != nil {
				ds.consecutiveFailures++

				if ds.consecutiveFailures >= s.maxFailures {
					backoff := calculateBackoff(ds.consecutiveFailures, s.baseBackoff, s.maxBackoff)
					ds.backoffUntil = time.Now().Add(backoff)
					slog.Warn("circuit breaker: device entering backoff",
						"device_id", dev.ID,
						"ip", dev.IPAddress,
						"consecutive_failures", ds.consecutiveFailures,
						"backoff_duration", backoff,
						"backoff_until", ds.backoffUntil.Format(time.RFC3339),
					)
				}

				// Only log as error if it's not a device-offline situation.
				if err != ErrDeviceOffline {
					slog.Error("poll cycle failed",
						"device_id", dev.ID,
						"ip", dev.IPAddress,
						"error", err,
					)
				}
			} else {
				// Success — reset circuit breaker if it was tripped.
				if ds.consecutiveFailures > 0 {
					slog.Info("circuit breaker: device recovered",
						"device_id", dev.ID,
						"ip", dev.IPAddress,
						"previous_failures", ds.consecutiveFailures,
					)
					observability.CircuitBreakerResets.Inc()
					ds.consecutiveFailures = 0
					ds.backoffUntil = time.Time{}
				}
			}
		}
	}
}

// calculateBackoff computes the exponential backoff duration for the given
// number of consecutive failures: base * 2^(failures-1), capped at maxBackoff.
func calculateBackoff(failures int, baseBackoff, maxBackoff time.Duration) time.Duration {
	if failures <= 1 {
		return baseBackoff
	}
	backoff := baseBackoff * time.Duration(1<<uint(failures-1))
	if backoff > maxBackoff || backoff < 0 { // negative check guards against overflow
		return maxBackoff
	}
	return backoff
}
