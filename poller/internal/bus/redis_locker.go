package bus

import (
	"context"
	"time"

	"github.com/bsm/redislock"
)

// RedisBackupLocker adapts *redislock.Client to the BackupLocker interface.
type RedisBackupLocker struct {
	client *redislock.Client
}

// NewRedisBackupLocker wraps a redislock.Client for use by BackupResponder.
func NewRedisBackupLocker(client *redislock.Client) *RedisBackupLocker {
	return &RedisBackupLocker{client: client}
}

// ObtainLock attempts to acquire a Redis distributed lock.
// Returns ErrLockNotObtained if the lock is already held.
func (l *RedisBackupLocker) ObtainLock(ctx context.Context, key string, ttl time.Duration) (BackupLockHandle, error) {
	lock, err := l.client.Obtain(ctx, key, ttl, nil)
	if err == redislock.ErrNotObtained {
		return nil, ErrLockNotObtained
	}
	if err != nil {
		return nil, err
	}
	return &redisLockHandle{lock: lock}, nil
}

// redisLockHandle wraps *redislock.Lock to implement BackupLockHandle.
type redisLockHandle struct {
	lock *redislock.Lock
}

// Release releases the held Redis lock.
func (h *redisLockHandle) Release(ctx context.Context) error {
	return h.lock.Release(ctx)
}
