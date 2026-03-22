package snmp

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/redis/go-redis/v9"
)

// CounterInput represents a single counter value to compute a delta for.
type CounterInput struct {
	Value uint64
	Bits  int // 32 or 64
}

// CounterState stores the previous value and timestamp for delta computation.
type CounterState struct {
	Value     uint64 `json:"value"`
	Timestamp int64  `json:"ts"`
}

// CounterResult holds the computed delta and rate for a single counter OID.
type CounterResult struct {
	OID            string
	Delta          uint64
	Rate           float64
	ElapsedSeconds float64
}

// CounterCache provides Redis-backed counter delta computation.
type CounterCache struct {
	rdb redis.Cmdable
}

// NewCounterCache creates a CounterCache backed by the given Redis client.
func NewCounterCache(rdb redis.Cmdable) *CounterCache {
	return &CounterCache{rdb: rdb}
}

// counterKey returns the Redis key for a device+OID counter state.
func counterKey(deviceID, oid string) string {
	return "snmp:counter:" + deviceID + ":" + oid
}

// ComputeDeltas fetches previous counter states from Redis, computes deltas
// and rates, then stores the new values. First poll returns empty results.
func (c *CounterCache) ComputeDeltas(ctx context.Context, deviceID string, counters map[string]CounterInput) ([]CounterResult, error) {
	if len(counters) == 0 {
		return nil, nil
	}

	// Build keys and ordered OID list.
	oids := make([]string, 0, len(counters))
	keys := make([]string, 0, len(counters))
	for oid := range counters {
		oids = append(oids, oid)
		keys = append(keys, counterKey(deviceID, oid))
	}

	// MGET all previous states in one round-trip.
	vals, err := c.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("redis MGET counter states: %w", err)
	}

	now := time.Now().Unix()
	var results []CounterResult
	pipe := c.rdb.Pipeline()

	for i, oid := range oids {
		input := counters[oid]
		newState := CounterState{Value: input.Value, Timestamp: now}
		stateJSON, _ := json.Marshal(newState)

		pipe.Set(ctx, keys[i], stateJSON, 600*time.Second)

		// If no previous value, skip (first poll).
		if vals[i] == nil {
			continue
		}
		raw, ok := vals[i].(string)
		if !ok {
			continue
		}

		var prev CounterState
		if err := json.Unmarshal([]byte(raw), &prev); err != nil {
			continue
		}

		delta, deltaOK := computeCounterDelta(prev.Value, input.Value, input.Bits)
		if !deltaOK {
			continue
		}

		elapsed := float64(now - prev.Timestamp)
		if elapsed <= 0 {
			continue
		}

		results = append(results, CounterResult{
			OID:            oid,
			Delta:          delta,
			Rate:           float64(delta) / elapsed,
			ElapsedSeconds: elapsed,
		})
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("redis pipeline exec: %w", err)
	}

	return results, nil
}

// computeCounterDelta computes the delta between two counter values,
// handling wraparound for 32-bit and 64-bit counters. Returns ok=false
// if the delta appears to be a device reset (> 90% of max value).
func computeCounterDelta(prev, curr uint64, counterBits int) (delta uint64, ok bool) {
	var maxVal uint64
	if counterBits == 32 {
		maxVal = math.MaxUint32
	} else {
		maxVal = math.MaxUint64
	}

	if curr >= prev {
		delta = curr - prev
	} else {
		// Wraparound: (max - prev) + curr + 1
		if counterBits == 64 {
			// For 64-bit, overflow in the addition is the wraparound itself.
			delta = (maxVal - prev) + curr + 1
		} else {
			delta = (maxVal - prev) + curr + 1
		}
	}

	// Sanity check: if delta > 90% of max, likely a device reset.
	threshold := maxVal / 10 * 9
	if delta > threshold {
		return 0, false
	}

	return delta, true
}
