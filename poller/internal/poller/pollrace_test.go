package poller

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/bsm/redislock"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// PollDevice used to acquire "poll:device:{id}" itself, the same key the
// scheduler acquires at scheduler.go:246 and holds across collector.Collect.
// The second acquire could therefore never succeed: PollDevice logged at DEBUG
// and returned nil, the scheduler read nil as a successful poll and reset the
// circuit breaker, and no RouterOS device was ever contacted. Shipped in
// v9.8.0 through v9.9.0 (introduced by cec645a, which lifted the lock into the
// scheduler for SNMP's benefit but left the original in place).
//
// This test holds the scheduler's lock and asserts PollDevice still does its
// work. Before the fix it returns nil; after it, it proceeds far enough to
// fail on credentials, which is proof it is no longer short-circuiting.
func TestPollDevice_RunsWhileTheSchedulerHoldsTheDeviceLock(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rc.Close() })

	dev := store.Device{
		ID:                   "22222222-2222-2222-2222-222222222222",
		TenantID:             "11111111-1111-1111-1111-111111111111",
		IPAddress:            "203.0.113.1",
		APIPort:              8728,
		APISSLPort:           8729,
		EncryptedCredentials: []byte("not-decryptable"),
	}

	// Exactly what the scheduler does before dispatching to the collector.
	locker := redislock.New(rc)
	held, err := locker.Obtain(context.Background(), "poll:device:"+dev.ID, 30*time.Second, nil)
	require.NoError(t, err, "precondition: the scheduler's lock must be obtainable")
	t.Cleanup(func() { _ = held.Release(context.Background()) })

	// No transit client and no legacy key, so credential decryption fails and
	// PollDevice returns before it needs a publisher.
	creds := vault.NewCredentialCache(8, time.Minute, nil, nil, nil)

	err = PollDevice(context.Background(), dev, nil, creds, 2*time.Second, 2*time.Second)

	require.Error(t, err,
		"PollDevice returned nil while the scheduler held the device lock: it skipped the poll "+
			"and the scheduler will record that as a successful cycle")
	assert.Contains(t, err.Error(), "credential",
		"expected to reach credential decryption, which means the lock no longer short-circuits the poll")
}

// The defect was not that PollDevice took the wrong branch — it was that a
// skip returned nil, which the scheduler counted as a successful poll and used
// to reset the circuit breaker. Removing the locker makes that unrepresentable
// rather than handled: with no Obtain in scope there is no ErrNotObtained to
// receive and no skip path to return nil from.
//
// A test against that path would now pass by never executing it, which is the
// defect class this release has spent the night finding. So assert the property
// that actually holds instead: PollDevice depends on no locker, and putting one
// back fails here rather than silently in production.
func TestPollDevice_TakesNoLocker(t *testing.T) {
	fn := reflect.TypeOf(PollDevice)
	lockerType := reflect.TypeOf((*redislock.Client)(nil))

	for i := 0; i < fn.NumIn(); i++ {
		assert.NotEqual(t, lockerType, fn.In(i),
			"PollDevice parameter %d is a *redislock.Client. Locking belongs to the "+
				"scheduler, which holds poll:device:{id} across this entire call — a second "+
				"acquire here can never succeed.", i)
	}
}
