package poller

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mikrotik-portal/poller/internal/store"
	"github.com/mikrotik-portal/poller/internal/vault"
)

// mockDeviceFetcher implements DeviceFetcher for testing.
type mockDeviceFetcher struct {
	devices []store.Device
	err     error
}

func (m *mockDeviceFetcher) FetchDevices(ctx context.Context) ([]store.Device, error) {
	return m.devices, m.err
}

// newTestScheduler creates a Scheduler with a mock DeviceFetcher for testing.
// Uses nil for locker and publisher since reconcileDevices doesn't use them.
func newTestScheduler(fetcher DeviceFetcher) *Scheduler {
	// Create a minimal credential cache for testing (no transit, no legacy key, no db).
	testCache := vault.NewCredentialCache(64, 5*time.Minute, nil, make([]byte, 32), nil)
	return &Scheduler{
		store:           fetcher,
		locker:          nil,
		publisher:       nil,
		credentialCache: testCache,
		pollInterval:    24 * time.Hour, // Never fires during test
		connTimeout:     time.Second,
		cmdTimeout:      time.Second,
		refreshPeriod:   time.Second,
		maxFailures:     5,
		baseBackoff:     30 * time.Second,
		maxBackoff:      15 * time.Minute,
		activeDevices:   make(map[string]*deviceState),
	}
}

func TestReconcileDevices_StartsNewDevices(t *testing.T) {
	devices := []store.Device{
		{ID: "dev-1", TenantID: "t-1", IPAddress: "192.168.1.1", APISSLPort: 8729},
		{ID: "dev-2", TenantID: "t-1", IPAddress: "192.168.1.2", APISSLPort: 8729},
	}
	fetcher := &mockDeviceFetcher{devices: devices}
	sched := newTestScheduler(fetcher)

	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := sched.reconcileDevices(ctx, &wg)
	require.NoError(t, err)

	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 2)
	_, hasDev1 := sched.activeDevices["dev-1"]
	_, hasDev2 := sched.activeDevices["dev-2"]
	assert.True(t, hasDev1)
	assert.True(t, hasDev2)
	sched.mu.Unlock()

	// Clean up: cancel context and wait for goroutines
	cancel()
	wg.Wait()
}

func TestReconcileDevices_StopsRemovedDevices(t *testing.T) {
	// Start with one active device
	sched := newTestScheduler(&mockDeviceFetcher{devices: []store.Device{}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Manually add a device to activeDevices to simulate it was previously running
	devCtx, devCancel := context.WithCancel(ctx)
	sched.activeDevices["dev-removed"] = &deviceState{cancel: devCancel}

	// Track if cancel was called
	cancelled := false
	go func() {
		<-devCtx.Done()
		cancelled = true
	}()

	var wg sync.WaitGroup
	// FetchDevices returns empty -> dev-removed should be stopped
	err := sched.reconcileDevices(ctx, &wg)
	require.NoError(t, err)

	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 0)
	sched.mu.Unlock()

	// Give the goroutine a moment to register the cancel
	time.Sleep(10 * time.Millisecond)
	assert.True(t, cancelled)

	cancel()
	wg.Wait()
}

func TestReconcileDevices_PreservesExistingDevices(t *testing.T) {
	devices := []store.Device{
		{ID: "dev-existing", TenantID: "t-1", IPAddress: "192.168.1.1", APISSLPort: 8729},
		{ID: "dev-new", TenantID: "t-1", IPAddress: "192.168.1.2", APISSLPort: 8729},
	}
	fetcher := &mockDeviceFetcher{devices: devices}
	sched := newTestScheduler(fetcher)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Pre-populate dev-existing as if it was already running
	existingCtx, existingCancel := context.WithCancel(ctx)
	_ = existingCtx
	sched.activeDevices["dev-existing"] = &deviceState{cancel: existingCancel}

	var wg sync.WaitGroup
	err := sched.reconcileDevices(ctx, &wg)
	require.NoError(t, err)

	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 2)
	// dev-existing should still have its ORIGINAL cancel function (not replaced)
	assert.Equal(t, fmt.Sprintf("%p", existingCancel), fmt.Sprintf("%p", sched.activeDevices["dev-existing"].cancel))
	_, hasNew := sched.activeDevices["dev-new"]
	assert.True(t, hasNew)
	sched.mu.Unlock()

	cancel()
	wg.Wait()
}

func TestReconcileDevices_HandlesEmptyDatabase(t *testing.T) {
	fetcher := &mockDeviceFetcher{devices: []store.Device{}}
	sched := newTestScheduler(fetcher)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	err := sched.reconcileDevices(ctx, &wg)
	require.NoError(t, err)

	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 0)
	sched.mu.Unlock()

	cancel()
	wg.Wait()
}

func TestReconcileDevices_FetchError(t *testing.T) {
	fetcher := &mockDeviceFetcher{err: fmt.Errorf("connection refused")}
	sched := newTestScheduler(fetcher)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Pre-populate a device
	devCancel := func() {}
	sched.activeDevices["dev-1"] = &deviceState{cancel: devCancel}

	var wg sync.WaitGroup
	err := sched.reconcileDevices(ctx, &wg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "connection refused")

	// Active devices should be unchanged (no side effects on error)
	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 1)
	sched.mu.Unlock()

	cancel()
	wg.Wait()
}
