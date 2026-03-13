---
phase: 03-snapshot-ingestion
plan: 01
subsystem: api
tags: [nats, jetstream, openbao, transit, encryption, postgresql, prometheus, dedup]

# Dependency graph
requires:
  - phase: 01-database-schema
    provides: RouterConfigSnapshot model and router_config_snapshots table
  - phase: 02-poller-config-collection
    provides: Go poller publishes config.snapshot.> NATS messages
provides:
  - NATS subscriber consuming config.snapshot.> messages
  - SHA256 dedup preventing duplicate snapshot storage
  - OpenBao Transit encryption of config text before INSERT
  - Prometheus metrics for ingestion monitoring
affects: [04-diff-engine, snapshot-api, config-timeline]

# Tech tracking
tech-stack:
  added: [prometheus_client]
  patterns: [nats-subscriber-with-dedup, transit-encrypt-before-insert]

key-files:
  created:
    - backend/app/services/config_snapshot_subscriber.py
    - backend/tests/test_config_snapshot_subscriber.py
  modified:
    - backend/app/main.py

key-decisions:
  - "Trust poller-provided SHA256 hash (no recompute on backend)"
  - "Raw SQL for dedup SELECT and INSERT (consistent with nats_subscriber.py pattern)"
  - "OpenBao Transit service instantiated per-message with close() for connection hygiene"

patterns-established:
  - "Config snapshot ingestion: dedup by SHA256 -> encrypt -> INSERT -> ack"
  - "Transit failure causes nak (NATS retry), plaintext never stored as fallback"

requirements-completed: [STOR-02]

# Metrics
duration: 4min
completed: 2026-03-13
---

# Phase 3 Plan 1: Config Snapshot Subscriber Summary

**NATS subscriber ingesting config snapshots with SHA256 dedup, OpenBao Transit encryption, and Prometheus metrics**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T02:44:01Z
- **Completed:** 2026-03-13T02:48:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- NATS subscriber consuming config.snapshot.> on DEVICE_EVENTS stream with durable consumer
- SHA256 dedup: duplicate snapshots silently skipped at debug level with Prometheus counter
- OpenBao Transit encryption: plaintext never stored in PostgreSQL, Transit failure causes nak
- Malformed and orphan device messages acked and discarded safely with warning logs
- 6 unit tests covering all handler paths (new, duplicate, encrypt fail, malformed, orphan, first)
- Wired into main.py lifespan with non-fatal startup pattern

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests** - `9d82741` (test)
2. **Task 1 (GREEN): Config snapshot subscriber** - `3ab9f27` (feat)
3. **Task 2: Wire into main.py lifespan** - `0db0641` (feat)

_TDD task had RED + GREEN commits_

## Files Created/Modified
- `backend/app/services/config_snapshot_subscriber.py` - NATS subscriber with dedup, encryption, metrics
- `backend/tests/test_config_snapshot_subscriber.py` - 6 unit tests for all handler paths
- `backend/app/main.py` - Lifespan wiring for start/stop

## Decisions Made
- Trust poller-provided SHA256 hash (no recompute on backend) -- per project decision
- Raw SQL for dedup SELECT and INSERT -- consistent with existing nats_subscriber.py pattern
- OpenBao Transit service instantiated per-message with close() -- connection hygiene
- config_text never appears in any log statement -- contains passwords and keys

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Config snapshot subscriber ready to receive messages from Go poller
- RouterConfigSnapshot rows will be available for diff engine (Phase 4)
- Prometheus metrics exposed for monitoring ingestion rate and errors

---
*Phase: 03-snapshot-ingestion*
*Completed: 2026-03-13*
