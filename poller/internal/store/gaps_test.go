package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeGapWriter records what the recorder asked it to persist, and can be told
// to fail so the retry path is exercised without a database.
type fakeGapWriter struct {
	inserted   []GapRecord
	closed     []closedCall
	outages    []outageCall
	heartbeats []time.Time
	lastBeat   time.Time
	lastFound  bool
	insertErr  error
	nextID     int
	beatErr    error
}

type closedCall struct {
	id      string
	endedAt time.Time
	dropped int
}

type outageCall struct {
	from, to time.Time
	reason   string
}

func (f *fakeGapWriter) InsertGap(_ context.Context, g GapRecord) (string, error) {
	if f.insertErr != nil {
		return "", f.insertErr
	}
	f.nextID++
	f.inserted = append(f.inserted, g)
	return string(rune('a' + f.nextID - 1)), nil
}

func (f *fakeGapWriter) CloseGap(_ context.Context, id string, endedAt time.Time, dropped int) error {
	f.closed = append(f.closed, closedCall{id: id, endedAt: endedAt, dropped: dropped})
	return nil
}

func (f *fakeGapWriter) LastHeartbeat(context.Context, string) (time.Time, bool, error) {
	return f.lastBeat, f.lastFound, nil
}

func (f *fakeGapWriter) WriteHeartbeat(_ context.Context, _ string, at time.Time) error {
	if f.beatErr != nil {
		return f.beatErr
	}
	f.heartbeats = append(f.heartbeats, at)
	return nil
}

func (f *fakeGapWriter) InsertOutage(_ context.Context, _ string, from, to time.Time, reason string) error {
	f.outages = append(f.outages, outageCall{from: from, to: to, reason: reason})
	return nil
}

// clock lets a test advance time without sleeping.
type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestRecorder(w GapWriter) (*GapRecorder, *clock) {
	c := &clock{t: time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)}
	r := NewGapRecorder(w, "poller-test")
	r.now = c.now
	return r, c
}

// ---------------------------------------------------------------------------
// Publish-failure accumulator
// ---------------------------------------------------------------------------

func TestGapRecorder_FirstFailureOpensOneGap(t *testing.T) {
	w := &fakeGapWriter{}
	r, _ := newTestRecorder(w)

	r.PublishFailed(context.Background(), "dev1", "tenant1", "metrics", errors.New("nats: no responders"))

	require.Len(t, w.inserted, 1)
	assert.Equal(t, "publish_failure", w.inserted[0].Kind)
	assert.Equal(t, "dev1", w.inserted[0].DeviceID)
	assert.Equal(t, "tenant1", w.inserted[0].TenantID)
	assert.Equal(t, "metrics", w.inserted[0].Stream)
	assert.Contains(t, w.inserted[0].Reason, "no responders")
	assert.Empty(t, w.closed)
}

func TestGapRecorder_RepeatedFailuresCoalesceIntoOneGap(t *testing.T) {
	w := &fakeGapWriter{}
	r, c := newTestRecorder(w)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))
		c.advance(2 * time.Minute)
	}

	assert.Len(t, w.inserted, 1, "an outage is one gap, not one row per dropped sample")
}

func TestGapRecorder_SuccessClosesTheGapWithTheDroppedCount(t *testing.T) {
	w := &fakeGapWriter{}
	r, c := newTestRecorder(w)
	ctx := context.Background()
	started := c.now()

	r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))
	c.advance(2 * time.Minute)
	r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))
	c.advance(2 * time.Minute)
	r.PublishSucceeded(ctx, "dev1", "metrics")

	require.Len(t, w.closed, 1)
	assert.Equal(t, 2, w.closed[0].dropped, "both dropped samples must be counted")
	assert.Equal(t, started.Add(4*time.Minute), w.closed[0].endedAt)
}

// The success path runs on every healthy poll of every device. It must not
// touch the database when there is nothing to close.
func TestGapRecorder_SuccessWithNoOpenGapDoesNothing(t *testing.T) {
	w := &fakeGapWriter{}
	r, _ := newTestRecorder(w)

	r.PublishSucceeded(context.Background(), "dev1", "metrics")

	assert.Empty(t, w.inserted)
	assert.Empty(t, w.closed)
}

func TestGapRecorder_StreamsAreTrackedIndependently(t *testing.T) {
	w := &fakeGapWriter{}
	r, _ := newTestRecorder(w)
	ctx := context.Background()

	r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))
	r.PublishFailed(ctx, "dev1", "tenant1", "status", errors.New("down"))
	r.PublishSucceeded(ctx, "dev1", "metrics")

	assert.Len(t, w.inserted, 2)
	require.Len(t, w.closed, 1, "closing metrics must not close the status gap")
}

// If PostgreSQL is unreachable the INSERT fails, but the gap is real and must
// not be forgotten. It stays open in memory and the write is retried.
func TestGapRecorder_RetriesTheInsertWhenTheDatabaseWasDown(t *testing.T) {
	w := &fakeGapWriter{insertErr: errors.New("connection refused")}
	r, c := newTestRecorder(w)
	ctx := context.Background()

	r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))
	require.Empty(t, w.inserted)

	c.advance(2 * time.Minute)
	w.insertErr = nil
	r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))

	require.Len(t, w.inserted, 1, "the gap must be written once the database returns")
	assert.Equal(t, c.now().Add(-2*time.Minute), w.inserted[0].Started,
		"the gap starts when delivery first failed, not when the write finally succeeded")
}

func TestGapRecorder_CloseIsSkippedWhenTheGapWasNeverWritten(t *testing.T) {
	w := &fakeGapWriter{insertErr: errors.New("connection refused")}
	r, _ := newTestRecorder(w)
	ctx := context.Background()

	r.PublishFailed(ctx, "dev1", "tenant1", "metrics", errors.New("down"))
	r.PublishSucceeded(ctx, "dev1", "metrics")

	assert.Empty(t, w.closed, "there is no row to close")
}

// ---------------------------------------------------------------------------
// Heartbeat discontinuity
//
// A dead process cannot record its own absence, so this is the only mechanism
// that covers an OOM kill, a host reboot, or PostgreSQL being unreachable.
// ---------------------------------------------------------------------------

func TestGapRecorder_FirstEverStartRecordsNoOutage(t *testing.T) {
	w := &fakeGapWriter{lastFound: false}
	r, _ := newTestRecorder(w)

	require.NoError(t, r.ReconcileStartup(context.Background(), 30*time.Second))

	assert.Empty(t, w.outages, "a fresh install has not been down, it has never run")
	assert.Len(t, w.heartbeats, 1)
}

func TestGapRecorder_CleanRestartRecordsNoOutage(t *testing.T) {
	c := &clock{t: time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)}
	w := &fakeGapWriter{lastFound: true, lastBeat: c.now().Add(-20 * time.Second)}
	r := NewGapRecorder(w, "poller-test")
	r.now = c.now

	require.NoError(t, r.ReconcileStartup(context.Background(), 30*time.Second))

	assert.Empty(t, w.outages, "a restart inside the heartbeat window is not a gap")
}

func TestGapRecorder_StaleHeartbeatRecordsTheOutageWindow(t *testing.T) {
	c := &clock{t: time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)}
	lastBeat := c.now().Add(-45 * time.Minute)
	w := &fakeGapWriter{lastFound: true, lastBeat: lastBeat}
	r := NewGapRecorder(w, "poller-test")
	r.now = c.now

	require.NoError(t, r.ReconcileStartup(context.Background(), 30*time.Second))

	require.Len(t, w.outages, 1)
	assert.Equal(t, lastBeat, w.outages[0].from)
	assert.Equal(t, c.now(), w.outages[0].to)
	assert.Contains(t, w.outages[0].reason, "heartbeat")
}
