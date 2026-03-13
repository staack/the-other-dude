---
phase: 06-history-api
plan: 02
subsystem: api
tags: [fastapi, sqlalchemy, openbao, transit-decrypt, rbac, snapshot]

# Dependency graph
requires:
  - phase: 06-history-api
    provides: config_history_service.py with get_config_history, config_history router with RBAC
  - phase: 05-diff-engine
    provides: router_config_diffs and router_config_snapshots tables with encrypted config data
provides:
  - GET /api/tenants/{tid}/devices/{did}/config/{snapshot_id} endpoint (decrypted snapshot)
  - GET /api/tenants/{tid}/devices/{did}/config/{snapshot_id}/diff endpoint (unified diff)
  - get_snapshot and get_snapshot_diff service functions
affects: [frontend-config-history, frontend-diff-viewer]

# Tech tracking
tech-stack:
  added: []
  patterns: [Transit decrypt in service layer with try/finally close, 404 for missing snapshots/diffs]

key-files:
  created: []
  modified:
    - backend/app/services/config_history_service.py
    - backend/app/routers/config_history.py
    - backend/tests/test_config_history_service.py

key-decisions:
  - "Transit decrypt in get_snapshot with try/finally for clean openbao lifecycle"
  - "500 error wrapping for Transit decrypt failures in router (not service)"

patterns-established:
  - "Snapshot retrieval filters by id + device_id + tenant_id for RLS-safe queries"

requirements-completed: [API-02, API-03, API-04]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 6 Plan 2: Snapshot View and Diff Retrieval Summary

**Snapshot view and diff retrieval endpoints with Transit decrypt for full config text and unified diff, enforcing viewer+ RBAC**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T04:01:58Z
- **Completed:** 2026-03-13T04:03:39Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- get_snapshot function decrypts config via OpenBao Transit and returns plaintext with metadata
- get_snapshot_diff function queries diff by new_snapshot_id for a device/tenant
- Two new router endpoints with viewer+ RBAC and config:read scope enforcement
- 4 new tests (8 total) covering decrypted content, not-found, diff retrieval, and no-diff cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Snapshot and diff service functions with tests (TDD)** - `83cd661` (feat)
2. **Task 2: Snapshot and diff router endpoints** - `af7007d` (feat)

## Files Created/Modified
- `backend/app/services/config_history_service.py` - Added get_snapshot (Transit decrypt) and get_snapshot_diff query functions
- `backend/app/routers/config_history.py` - Two new GET endpoints with RBAC, 404/500 error handling
- `backend/tests/test_config_history_service.py` - 4 new tests with mocked Transit and DB sessions

## Decisions Made
- Transit decrypt happens in service layer (get_snapshot), error wrapping in router layer (500 response)
- Query filters include device_id + tenant_id alongside snapshot_id for RLS-safe access

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 3 config history API endpoints complete (timeline, snapshot view, diff view)
- Phase 06 complete -- ready for frontend integration

---
*Phase: 06-history-api*
*Completed: 2026-03-13*
