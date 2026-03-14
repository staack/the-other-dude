package poller

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/staack/the-other-dude/poller/internal/device"
	"github.com/staack/the-other-dude/poller/internal/store"
)

// mockSSHHostKeyUpdater implements SSHHostKeyUpdater for testing.
type mockSSHHostKeyUpdater struct {
	mu           sync.Mutex
	updatedKeys  map[string]string // device_id -> fingerprint
	err          error
}

func newMockSSHHostKeyUpdater() *mockSSHHostKeyUpdater {
	return &mockSSHHostKeyUpdater{updatedKeys: make(map[string]string)}
}

func (m *mockSSHHostKeyUpdater) UpdateSSHHostKey(ctx context.Context, deviceID string, fingerprint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.updatedKeys[deviceID] = fingerprint
	return nil
}

func TestRandomJitter(t *testing.T) {
	// randomJitter(30, 300) returns value in [30s, 300s] range
	for i := 0; i < 100; i++ {
		j := randomJitter(30, 300)
		assert.GreaterOrEqual(t, j, 30*time.Second, "jitter should be >= 30s")
		assert.LessOrEqual(t, j, 300*time.Second, "jitter should be <= 300s")
	}
}

func TestRandomJitter_MinEqualsMax(t *testing.T) {
	j := randomJitter(60, 60)
	assert.Equal(t, 60*time.Second, j)
}

func TestCalculateBackupBackoff(t *testing.T) {
	// 1 failure: 5 min
	assert.Equal(t, 5*time.Minute, calculateBackupBackoff(1))
	// 2 failures: 15 min
	assert.Equal(t, 15*time.Minute, calculateBackupBackoff(2))
	// 3 failures: 1 hour (cap)
	assert.Equal(t, 1*time.Hour, calculateBackupBackoff(3))
	// 10 failures: still capped at 1 hour
	assert.Equal(t, 1*time.Hour, calculateBackupBackoff(10))
	// 0 failures: 5 min (floor)
	assert.Equal(t, 5*time.Minute, calculateBackupBackoff(0))
}

func TestShouldRetry_AuthFailedBlocks(t *testing.T) {
	state := &backupDeviceState{
		lastErrorKind: device.ErrAuthFailed,
	}
	assert.False(t, shouldRetry(state), "auth failure should block retry")
}

func TestShouldRetry_HostKeyMismatchBlocks(t *testing.T) {
	state := &backupDeviceState{
		lastErrorKind: device.ErrHostKeyMismatch,
	}
	assert.False(t, shouldRetry(state), "host key mismatch should block retry")
}

func TestShouldRetry_TransientErrorAllows(t *testing.T) {
	state := &backupDeviceState{
		lastErrorKind: device.ErrTimeout,
	}
	assert.True(t, shouldRetry(state), "transient errors should allow retry")
}

func TestShouldRetry_NoError(t *testing.T) {
	state := &backupDeviceState{}
	assert.True(t, shouldRetry(state), "no previous error should allow retry")
}

func TestShouldRetry_UnknownErrorAllows(t *testing.T) {
	state := &backupDeviceState{
		lastErrorKind: device.ErrUnknown,
	}
	assert.True(t, shouldRetry(state), "unknown errors should allow retry")
}

func TestBackupScheduler_OnlineOnlyGating(t *testing.T) {
	// Device not in Redis (no status key) -> should be allowed (first poll hasn't happened)
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()

	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()

	// No status key set -> isDeviceOnline should return true (assume might be online)
	online := isDeviceOnline(context.Background(), rc, "dev-1")
	assert.True(t, online, "device with no status key should be considered potentially online")

	// Set status to "online" -> should return true
	mr.Set("device:dev-2:status", "online")
	online = isDeviceOnline(context.Background(), rc, "dev-2")
	assert.True(t, online, "device with online status should be online")

	// Set status to "offline" -> should return false
	mr.Set("device:dev-3:status", "offline")
	online = isDeviceOnline(context.Background(), rc, "dev-3")
	assert.False(t, online, "device with offline status should not be online")
}

func TestBackupScheduler_ConcurrencySemaphore(t *testing.T) {
	// When semaphore is full, backup waits (does not drop)
	maxConcurrent := 2
	sem := make(chan struct{}, maxConcurrent)

	// Fill the semaphore
	sem <- struct{}{}
	sem <- struct{}{}

	// Try to acquire in a goroutine -- should block
	acquired := make(chan struct{})
	go func() {
		sem <- struct{}{} // This should block
		close(acquired)
	}()

	// Give a moment and verify it hasn't acquired
	select {
	case <-acquired:
		t.Fatal("semaphore should have blocked but didn't")
	case <-time.After(50 * time.Millisecond):
		// Expected: still blocked
	}

	// Release one slot
	<-sem

	// Now the goroutine should acquire
	select {
	case <-acquired:
		// Expected: unblocked after release
	case <-time.After(time.Second):
		t.Fatal("semaphore should have unblocked after release")
	}

	// Drain remaining
	<-sem
	<-sem
}

func TestBackupScheduler_ReconcileStartsNewDevices(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()

	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()

	devices := []store.Device{
		{ID: "dev-1", TenantID: "t-1", IPAddress: "10.0.0.1", SSHPort: 22},
		{ID: "dev-2", TenantID: "t-1", IPAddress: "10.0.0.2", SSHPort: 22},
	}
	fetcher := &mockDeviceFetcher{devices: devices}
	hostKeyUpdater := newMockSSHHostKeyUpdater()

	bs := NewBackupScheduler(
		fetcher,
		hostKeyUpdater,
		nil, // locker
		nil, // publisher
		nil, // credentialCache
		rc,
		6*time.Hour,
		60*time.Second,
		60*time.Second,
		10,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	err = bs.reconcileBackupDevices(ctx, &wg)
	require.NoError(t, err)

	bs.mu.Lock()
	assert.Len(t, bs.activeDevices, 2)
	_, hasDev1 := bs.activeDevices["dev-1"]
	_, hasDev2 := bs.activeDevices["dev-2"]
	assert.True(t, hasDev1)
	assert.True(t, hasDev2)
	bs.mu.Unlock()

	cancel()
	wg.Wait()
}

func TestBackupScheduler_ReconcileStopsRemovedDevices(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()

	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()

	fetcher := &mockDeviceFetcher{devices: []store.Device{}}
	hostKeyUpdater := newMockSSHHostKeyUpdater()

	bs := NewBackupScheduler(
		fetcher,
		hostKeyUpdater,
		nil, nil, nil,
		rc,
		6*time.Hour, 60*time.Second, 60*time.Second, 10,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Pre-populate a device
	devCtx, devCancel := context.WithCancel(ctx)
	_ = devCtx
	bs.activeDevices["dev-removed"] = &backupDeviceState{cancel: devCancel}

	var wg sync.WaitGroup
	err = bs.reconcileBackupDevices(ctx, &wg)
	require.NoError(t, err)

	bs.mu.Lock()
	assert.Len(t, bs.activeDevices, 0)
	bs.mu.Unlock()

	cancel()
	wg.Wait()
}
