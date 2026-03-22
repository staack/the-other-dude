package snmp

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- computeCounterDelta unit tests ---

func TestCounterDelta_NormalIncrement32(t *testing.T) {
	delta, ok := computeCounterDelta(100, 200, 32)
	assert.True(t, ok)
	assert.Equal(t, uint64(100), delta)
}

func TestCounterDelta_Counter32Wraparound(t *testing.T) {
	// 4294967290 -> 10 wraps around MaxUint32 (4294967295)
	// delta = (4294967295 - 4294967290) + 10 + 1 = 16
	delta, ok := computeCounterDelta(4294967290, 10, 32)
	assert.True(t, ok)
	assert.Equal(t, uint64(16), delta)
}

func TestCounterDelta_Counter32Reset(t *testing.T) {
	// 100 -> 50: curr < prev, wrap delta would be huge (> 90% of MaxUint32)
	// This indicates a device reset, not a legitimate wrap.
	_, ok := computeCounterDelta(100, 50, 32)
	assert.False(t, ok, "should discard: delta > 90%% of MaxUint32 indicates device reset")
}

func TestCounterDelta_Counter64NormalIncrement(t *testing.T) {
	delta, ok := computeCounterDelta(1000000, 2000000, 64)
	assert.True(t, ok)
	assert.Equal(t, uint64(1000000), delta)
}

func TestCounterDelta_Counter64Reset(t *testing.T) {
	// prev=1000000000000 -> curr=50: wrap delta = (MaxUint64 - 1e12) + 50 + 1
	// which is > 90% of MaxUint64, indicating a device reset (not a wrap).
	_, ok := computeCounterDelta(1000000000000, 50, 64)
	assert.False(t, ok, "should discard: moderate prev to tiny curr on 64-bit indicates device reset")
}

func TestCounterDelta_ZeroDelta(t *testing.T) {
	delta, ok := computeCounterDelta(500, 500, 32)
	assert.True(t, ok)
	assert.Equal(t, uint64(0), delta)
}

// --- CounterCache integration tests ---

func TestCounterCache_FirstPollReturnsEmpty(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	cc := NewCounterCache(rdb)
	ctx := context.Background()

	counters := map[string]CounterInput{
		".1.3.6.1.2.1.2.2.1.10.1": {Value: 1000, Bits: 32},
		".1.3.6.1.2.1.2.2.1.16.1": {Value: 500, Bits: 32},
	}

	results, err := cc.ComputeDeltas(ctx, "dev-001", counters)
	require.NoError(t, err)
	assert.Empty(t, results, "first poll should produce no results (no previous values)")
}

func TestCounterCache_SecondPollComputesRate(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	cc := NewCounterCache(rdb)
	ctx := context.Background()

	// First poll: seed the cache
	counters1 := map[string]CounterInput{
		".1.3.6.1.2.1.2.2.1.10.1": {Value: 1000, Bits: 32},
	}
	_, err := cc.ComputeDeltas(ctx, "dev-001", counters1)
	require.NoError(t, err)

	// Advance time in miniredis by 10 seconds
	mr.FastForward(10 * time.Second)

	// Manually adjust the stored timestamp to be 10 seconds ago.
	// We do this because computeDeltas uses time.Now() internally,
	// and miniredis FastForward doesn't affect Go's time.Now().
	key := counterKey("dev-001", ".1.3.6.1.2.1.2.2.1.10.1")
	nowUnix := time.Now().Unix()
	rdb.Set(ctx, key, fmt.Sprintf(`{"value":1000,"ts":%d}`, nowUnix-10), 600*time.Second)

	// Second poll: should compute delta and rate
	counters2 := map[string]CounterInput{
		".1.3.6.1.2.1.2.2.1.10.1": {Value: 2000, Bits: 32},
	}
	results, err := cc.ComputeDeltas(ctx, "dev-001", counters2)
	require.NoError(t, err)
	require.Len(t, results, 1)

	assert.Equal(t, ".1.3.6.1.2.1.2.2.1.10.1", results[0].OID)
	assert.Equal(t, uint64(1000), results[0].Delta)
	assert.InDelta(t, 100.0, results[0].Rate, 1.0, "rate should be ~100 (1000 delta / 10s)")
	assert.InDelta(t, 10.0, results[0].ElapsedSeconds, 1.0)
}

func TestCounterCache_RedisKeyFormat(t *testing.T) {
	key := counterKey("device-abc", ".1.3.6.1.2.1.2.2.1.10.1")
	assert.Equal(t, "snmp:counter:device-abc:.1.3.6.1.2.1.2.2.1.10.1", key)
}

func TestCounterCache_StoresWithTTL(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	cc := NewCounterCache(rdb)
	ctx := context.Background()

	counters := map[string]CounterInput{
		".1.3.6.1.2.1.2.2.1.10.1": {Value: 1000, Bits: 32},
	}

	_, err := cc.ComputeDeltas(ctx, "dev-001", counters)
	require.NoError(t, err)

	// Verify the key exists in Redis with a TTL
	key := counterKey("dev-001", ".1.3.6.1.2.1.2.2.1.10.1")
	ttl := mr.TTL(key)
	assert.True(t, ttl > 0 && ttl <= 600*time.Second, "TTL should be set to ~600s, got %v", ttl)
}
