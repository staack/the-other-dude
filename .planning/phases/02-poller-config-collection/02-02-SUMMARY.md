---
phase: 02-poller-config-collection
plan: 02
subsystem: poller
tags: [ssh, backup, scheduler, nats, routeros, concurrency, tofu, redis]

requires:
  - phase: 02-poller-config-collection/01
    provides: SSH executor, config normalizer, NATS ConfigSnapshotEvent, Prometheus metrics, config fields
provides:
  - BackupScheduler with per-device goroutines managing periodic SSH config collection
  - Concurrency-limited config backup pipeline (SSH -> normalize -> hash -> NATS publish)
  - TOFU host key verification with persistent fingerprint storage
  - Auth/hostkey error blocking with transient error exponential backoff
  - SSHHostKeyUpdater consumer-side interface
affects: [03-backend-snapshot-consumer, api, poller]

tech-stack:
  added: []
  patterns: [per-device goroutine lifecycle, buffered channel semaphore, Redis online gating]

key-files:
  created:
    - poller/internal/poller/backup_scheduler.go
    - poller/internal/poller/backup_scheduler_test.go
  modified:
    - poller/internal/poller/interfaces.go
    - poller/cmd/poller/main.go

key-decisions:
  - "BackupScheduler runs independently from status poll scheduler with separate goroutines"
  - "Semaphore uses buffered channel pattern matching existing codebase style"
  - "Device with no Redis status key assumed potentially online (first poll not yet completed)"

patterns-established:
  - "Backup goroutine pattern: jitter -> initial backup -> ticker loop with gating checks"
  - "Error classification: auth/hostkey block retries, transient errors use exponential backoff"

requirements-completed: [COLL-01, COLL-03, COLL-05, COLL-06]

duration: 4min
completed: 2026-03-13
---

# Phase 2 Plan 2: Backup Scheduler Summary

**BackupScheduler orchestrating periodic SSH config collection with per-device goroutines, concurrency semaphore, TOFU verification, and NATS publishing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T01:51:27Z
- **Completed:** 2026-03-13T01:55:37Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- BackupScheduler manages per-device backup goroutines with 30-300s initial jitter
- Concurrency limited by configurable buffered channel semaphore (default 10)
- Auth failures and host key mismatches permanently block retries with clear log warnings
- Transient errors use stepped backoff (5m/15m/1h cap)
- Full pipeline wired into main.go running parallel to existing status poll scheduler

## Task Commits

Each task was committed atomically:

1. **Task 1: BackupScheduler with per-device goroutines** - `a884b09` (test) + `2653a32` (feat) -- TDD red/green
2. **Task 2: Wire BackupScheduler into main.go** - `d34817a` (feat)

## Files Created/Modified
- `poller/internal/poller/backup_scheduler.go` - BackupScheduler with per-device goroutines, concurrency control, SSH collection, NATS publishing
- `poller/internal/poller/backup_scheduler_test.go` - Unit tests for jitter, backoff, retry blocking, online gating, semaphore, reconciliation
- `poller/internal/poller/interfaces.go` - Added SSHHostKeyUpdater consumer-side interface
- `poller/cmd/poller/main.go` - BackupScheduler initialization and goroutine startup

## Decisions Made
- BackupScheduler runs independently from status poll scheduler -- separate goroutine pool, no shared state
- Semaphore uses buffered channel pattern (consistent with Go idioms, no external deps)
- Devices with no Redis status key assumed potentially online to avoid blocking first backup
- Locker nil-check allows tests to run without Redis lock infrastructure

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config backup pipeline complete: SSH -> normalize -> hash -> NATS publish
- Backend snapshot consumer (Phase 3) can subscribe to config.snapshot.create.> to receive snapshots
- Pre-existing integration test failures in poller package (missing certificate_authorities table) are unrelated to this work

---
*Phase: 02-poller-config-collection*
*Completed: 2026-03-13*
