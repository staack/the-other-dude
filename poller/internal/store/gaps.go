package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Gap kinds, matching the CHECK-free `kind` column in migration 041.
const (
	GapKindPublishFailure = "publish_failure"
	GapKindPollerOutage   = "poller_outage"
)

// GapRecord is one interval during which collected data could not be delivered.
type GapRecord struct {
	Kind     string
	TenantID string
	DeviceID string
	Stream   string
	Started  time.Time
	Reason   string
	Instance string
}

// GapWriter persists gap records. It is an interface so the accumulator logic
// in GapRecorder can be tested without a database — the poller's integration
// tests need Docker, and the rules about when a gap opens, coalesces and closes
// are exactly the part worth pinning down in a unit test.
type GapWriter interface {
	InsertGap(ctx context.Context, g GapRecord) (id string, err error)
	CloseGap(ctx context.Context, id string, endedAt time.Time, dropped int) error
	LastHeartbeat(ctx context.Context, instance string) (last time.Time, found bool, err error)
	WriteHeartbeat(ctx context.Context, instance string, at time.Time) error
	InsertOutage(ctx context.Context, instance string, from, to time.Time, reason string) error
}

// openGap is a gap the recorder believes is still running.
type openGap struct {
	// id is empty until the INSERT succeeds. A gap whose row was never written
	// (because PostgreSQL was down too) is retried on the next failure.
	id      string
	dropped int
	record  GapRecord
}

// GapRecorder turns delivery failures into rows an operator can see.
//
// Without it, a metric sample the poller collected but could not publish simply
// did not exist: worker.go logged a warning and dropped it, and nothing
// distinguished that from a device with nothing to report. It deliberately does
// not try to recover the lost samples — see migration 041 for why.
type GapRecorder struct {
	w        GapWriter
	instance string

	// now is swapped out in tests.
	now func() time.Time

	mu   sync.Mutex
	open map[string]*openGap
}

// NewGapRecorder returns a recorder that persists through w. instance
// identifies this poller process in poller_heartbeats.
func NewGapRecorder(w GapWriter, instance string) *GapRecorder {
	return &GapRecorder{
		w:        w,
		instance: instance,
		now:      time.Now,
		open:     make(map[string]*openGap),
	}
}

func gapKey(deviceID, stream string) string { return deviceID + "|" + stream }

// PublishFailed notes that one event could not be delivered.
//
// Consecutive failures for the same device and stream coalesce into a single
// gap rather than a row per dropped sample: an operator wants to know that
// metrics were missing between 14:02 and 14:19, not to page through 500 rows.
func (r *GapRecorder) PublishFailed(ctx context.Context, deviceID, tenantID, stream string, cause error) {
	if r == nil {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := gapKey(deviceID, stream)
	g, exists := r.open[key]
	if !exists {
		g = &openGap{
			record: GapRecord{
				Kind:     GapKindPublishFailure,
				TenantID: tenantID,
				DeviceID: deviceID,
				Stream:   stream,
				Started:  r.now(),
				Reason:   cause.Error(),
				Instance: r.instance,
			},
		}
		r.open[key] = g
	}
	g.dropped++

	// Retry the write on every failure until it lands. PostgreSQL is often the
	// thing that is down, and losing the record of the gap to the same outage
	// that caused it would defeat the point.
	if g.id == "" {
		id, err := r.w.InsertGap(ctx, g.record)
		if err != nil {
			slog.Debug("could not record ingest gap yet, will retry",
				"device_id", deviceID, "stream", stream, "error", err)
			return
		}
		g.id = id
		slog.Warn("ingest gap opened — collected data is not reaching the database",
			"device_id", deviceID, "stream", stream, "reason", g.record.Reason)
	}
}

// PublishSucceeded closes any gap open for this device and stream.
//
// This runs on the healthy path for every device on every poll, so it does no
// work at all when there is nothing to close.
func (r *GapRecorder) PublishSucceeded(ctx context.Context, deviceID, stream string) {
	if r == nil {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := gapKey(deviceID, stream)
	g, exists := r.open[key]
	if !exists {
		return
	}
	delete(r.open, key)

	// Nothing to close if the row was never written; the heartbeat mechanism
	// covers a poller that could not reach PostgreSQL at all.
	if g.id == "" {
		return
	}

	endedAt := r.now()
	if err := r.w.CloseGap(ctx, g.id, endedAt, g.dropped); err != nil {
		slog.Warn("failed to close ingest gap", "device_id", deviceID, "stream", stream, "error", err)
		return
	}
	slog.Info("ingest gap closed",
		"device_id", deviceID,
		"stream", stream,
		"dropped_samples", g.dropped,
		"duration", endedAt.Sub(g.record.Started),
	)
}

// ReconcileStartup records the window this poller was not running.
//
// A dead process cannot record its own absence, so the previous instance's last
// heartbeat is the only evidence of when it stopped. This is what covers an OOM
// kill, a host reboot, and PostgreSQL being unreachable — in the last case the
// heartbeat write fails too, which is exactly the signal we want.
func (r *GapRecorder) ReconcileStartup(ctx context.Context, interval time.Duration) error {
	last, found, err := r.w.LastHeartbeat(ctx, r.instance)
	if err != nil {
		return fmt.Errorf("reading last heartbeat: %w", err)
	}

	now := r.now()

	// A missed heartbeat or two is a restart, not an outage. Three intervals of
	// silence is a gap worth recording.
	staleAfter := 3 * interval

	switch {
	case !found:
		slog.Info("no previous poller heartbeat — treating this as a first run")
	case now.Sub(last) <= staleAfter:
		slog.Info("previous poller heartbeat is recent — no ingest gap to record",
			"last_seen", last.Format(time.RFC3339))
	default:
		reason := fmt.Sprintf("poller was not running: heartbeat stale for %s", now.Sub(last).Round(time.Second))
		if err := r.w.InsertOutage(ctx, r.instance, last, now, reason); err != nil {
			return fmt.Errorf("recording poller outage gap: %w", err)
		}
		slog.Warn("recorded a poller outage gap",
			"from", last.Format(time.RFC3339),
			"to", now.Format(time.RFC3339),
			"duration", now.Sub(last).Round(time.Second),
		)
	}

	return r.w.WriteHeartbeat(ctx, r.instance, now)
}

// RunHeartbeat writes a liveness row until ctx is cancelled. A failed write is
// not fatal: the missing heartbeat is itself the record of the outage, and the
// next successful start will notice the discontinuity.
func (r *GapRecorder) RunHeartbeat(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.w.WriteHeartbeat(ctx, r.instance, r.now()); err != nil {
				slog.Debug("heartbeat write failed", "error", err)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// PostgreSQL implementation
// ---------------------------------------------------------------------------

// PgGapWriter persists gaps through the poller's existing pgx pool.
type PgGapWriter struct {
	pool *pgxpool.Pool
}

// NewPgGapWriter returns a GapWriter backed by the poller's connection pool.
func NewPgGapWriter(pool *pgxpool.Pool) *PgGapWriter { return &PgGapWriter{pool: pool} }

// nullable turns an empty identifier into a SQL NULL, so stack-wide gaps do not
// carry a zero UUID that no tenant owns.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (p *PgGapWriter) InsertGap(ctx context.Context, g GapRecord) (string, error) {
	const query = `
		INSERT INTO ingest_gaps
			(kind, tenant_id, device_id, stream, started_at, reason, poller_instance)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id::text`

	var id string
	err := p.pool.QueryRow(ctx, query,
		g.Kind, nullable(g.TenantID), nullable(g.DeviceID), nullable(g.Stream),
		g.Started, g.Reason, g.Instance,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("inserting ingest gap: %w", err)
	}
	return id, nil
}

func (p *PgGapWriter) CloseGap(ctx context.Context, id string, endedAt time.Time, dropped int) error {
	const query = `
		UPDATE ingest_gaps
		   SET ended_at = $2, dropped_samples = $3
		 WHERE id = $1::uuid AND ended_at IS NULL`

	if _, err := p.pool.Exec(ctx, query, id, endedAt, dropped); err != nil {
		return fmt.Errorf("closing ingest gap %s: %w", id, err)
	}
	return nil
}

func (p *PgGapWriter) LastHeartbeat(ctx context.Context, instance string) (time.Time, bool, error) {
	const query = `SELECT last_seen_at FROM poller_heartbeats WHERE instance = $1`

	var last time.Time
	err := p.pool.QueryRow(ctx, query, instance).Scan(&last)
	if err != nil {
		// No row is the expected first-run case, not a failure.
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, fmt.Errorf("reading poller heartbeat: %w", err)
	}
	return last, true, nil
}

func (p *PgGapWriter) WriteHeartbeat(ctx context.Context, instance string, at time.Time) error {
	const query = `
		INSERT INTO poller_heartbeats (instance, last_seen_at, started_at)
		VALUES ($1, $2, $2)
		ON CONFLICT (instance) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`

	if _, err := p.pool.Exec(ctx, query, instance, at); err != nil {
		return fmt.Errorf("writing poller heartbeat: %w", err)
	}
	return nil
}

func (p *PgGapWriter) InsertOutage(ctx context.Context, instance string, from, to time.Time, reason string) error {
	const query = `
		INSERT INTO ingest_gaps
			(kind, started_at, ended_at, reason, poller_instance)
		VALUES ($1, $2, $3, $4, $5)`

	if _, err := p.pool.Exec(ctx, query, GapKindPollerOutage, from, to, reason, instance); err != nil {
		return fmt.Errorf("inserting poller outage gap: %w", err)
	}
	return nil
}
