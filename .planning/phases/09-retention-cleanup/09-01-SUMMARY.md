---
phase: 09-retention-cleanup
plan: 01
subsystem: database
tags: [apscheduler, retention, postgresql, prometheus, cascade-delete]

# Dependency graph
requires:
  - phase: 01-database-schema
    provides: router_config_snapshots table with CASCADE FK constraints
provides:
  - Automatic retention cleanup of expired config snapshots
  - CONFIG_RETENTION_DAYS env var for configurable retention period
  - Prometheus metrics for cleanup observability
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [APScheduler IntervalTrigger for periodic maintenance jobs]

key-files:
  created:
    - backend/app/services/retention_service.py
    - backend/tests/test_retention_service.py
  modified:
    - backend/app/config.py
    - backend/app/main.py

key-decisions:
  - "make_interval(days => :days) for parameterized PostgreSQL interval (no string concatenation)"
  - "24h IntervalTrigger with 1h jitter to stagger cleanup across instances"
  - "AdminAsyncSessionLocal (bypasses RLS) since retention is cross-tenant system operation"

patterns-established:
  - "IntervalTrigger pattern for periodic maintenance jobs (vs CronTrigger for scheduled backups)"

requirements-completed: [STOR-03, STOR-04]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 9 Plan 1: Retention Cleanup Summary

**Daily APScheduler job deletes config snapshots older than CONFIG_RETENTION_DAYS (default 90) with CASCADE FK cleanup of diffs and changes**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T04:31:48Z
- **Completed:** 2026-03-13T04:34:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Retention service with parameterized SQL DELETE using make_interval for safe interval binding
- APScheduler IntervalTrigger running every 24h with 1h jitter for stagger
- Prometheus counter and histogram for cleanup observability
- Wired into main.py lifespan with non-fatal startup pattern

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests** - `00bdde9` (test)
2. **Task 1 (GREEN): Implement retention service + config setting** - `a9f7a45` (feat)
3. **Task 2: Wire retention scheduler into lifespan** - `4d62bc9` (feat)

## Files Created/Modified
- `backend/app/services/retention_service.py` - Retention cleanup logic, scheduler, Prometheus metrics
- `backend/tests/test_retention_service.py` - 4 unit tests for cleanup function
- `backend/app/config.py` - Added CONFIG_RETENTION_DAYS setting (default 90)
- `backend/app/main.py` - Wired start/stop retention scheduler into lifespan

## Decisions Made
- Used make_interval(days => :days) for parameterized PostgreSQL interval (avoids string concatenation SQL injection risk)
- 24h IntervalTrigger with 1h jitter to stagger cleanup across instances
- AdminAsyncSessionLocal bypasses RLS since retention is a cross-tenant system operation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. CONFIG_RETENTION_DAYS defaults to 90 if not set.

## Next Phase Readiness
- Retention cleanup is fully operational, ready for phase 10
- No blockers

---
*Phase: 09-retention-cleanup*
*Completed: 2026-03-13*
