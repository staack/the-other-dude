package poller

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/staack/the-other-dude/poller/internal/store"
)

// recordingGapWriter captures what notePublish asked the recorder to persist.
type recordingGapWriter struct {
	inserted []store.GapRecord
	closed   int
}

func (w *recordingGapWriter) InsertGap(_ context.Context, g store.GapRecord) (string, error) {
	w.inserted = append(w.inserted, g)
	return "gap-1", nil
}

func (w *recordingGapWriter) CloseGap(context.Context, string, time.Time, int) error {
	w.closed++
	return nil
}

func (w *recordingGapWriter) LastHeartbeat(context.Context, string) (time.Time, bool, error) {
	return time.Time{}, false, nil
}

func (w *recordingGapWriter) WriteHeartbeat(context.Context, string, time.Time) error { return nil }

func (w *recordingGapWriter) InsertOutage(context.Context, string, time.Time, time.Time, string) error {
	return nil
}

// notePublish runs on the hot path for every device on every poll, including in
// every existing test in this package, where no recorder is configured. It must
// not panic on a nil recorder.
func TestNotePublish_ToleratesNoRecorder(t *testing.T) {
	previous := gapRecorder
	gapRecorder = nil
	t.Cleanup(func() { gapRecorder = previous })

	dev := store.Device{ID: "dev1", TenantID: "tenant1"}
	assert.NotPanics(t, func() {
		notePublish(context.Background(), dev, "metrics", errors.New("nats down"))
		notePublish(context.Background(), dev, "metrics", nil)
	})
}

func TestNotePublish_RecordsAndClearsTheGap(t *testing.T) {
	w := &recordingGapWriter{}
	previous := gapRecorder
	gapRecorder = store.NewGapRecorder(w, "test")
	t.Cleanup(func() { gapRecorder = previous })

	dev := store.Device{ID: "dev1", TenantID: "tenant1"}

	notePublish(context.Background(), dev, "metrics", errors.New("nats: no responders"))
	require.Len(t, w.inserted, 1, "a dropped sample must leave a row, not just a log line")
	assert.Equal(t, "dev1", w.inserted[0].DeviceID)
	assert.Equal(t, "metrics", w.inserted[0].Stream)

	notePublish(context.Background(), dev, "metrics", nil)
	assert.Equal(t, 1, w.closed, "delivery recovering must close the gap")
}
