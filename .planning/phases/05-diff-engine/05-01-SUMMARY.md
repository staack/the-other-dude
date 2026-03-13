---
phase: 05-diff-engine
plan: 01
subsystem: api
tags: [difflib, unified-diff, openbao, transit, prometheus, nats]

requires:
  - phase: 03-snapshot-ingestion
    provides: "config snapshot subscriber and router_config_snapshots table"
  - phase: 01-database-schema
    provides: "router_config_diffs table schema"
provides:
  - "generate_and_store_diff() for unified diff between consecutive snapshots"
  - "Prometheus metrics for diff generation success/failure/timing"
  - "Subscriber integration calling diff after snapshot INSERT"
affects: [06-change-parser, 07-timeline-api]

tech-stack:
  added: [difflib]
  patterns: [best-effort-secondary-operation, tdd-red-green]

key-files:
  created:
    - backend/app/services/config_diff_service.py
    - backend/tests/test_config_diff_service.py
  modified:
    - backend/app/services/config_snapshot_subscriber.py
    - backend/tests/test_config_snapshot_subscriber.py

key-decisions:
  - "Diff service instantiates its own OpenBaoTransitService per-call with close() for clean lifecycle"
  - "RETURNING id added to snapshot INSERT to capture new_snapshot_id for diff generation"
  - "Subscriber tests mock generate_and_store_diff to isolate snapshot logic from diff logic"

patterns-established:
  - "Best-effort secondary operations: wrap in try/except, log+count errors, never block primary flow"
  - "Line counting excludes unified diff headers (+++ and --- lines)"

requirements-completed: [DIFF-01, DIFF-02]

duration: 3min
completed: 2026-03-13
---

# Phase 5 Plan 1: Config Diff Service Summary

**Unified diff generation between consecutive config snapshots using difflib with Transit decrypt and best-effort error handling**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T03:30:07Z
- **Completed:** 2026-03-13T03:33:Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Config diff service generates unified diffs between consecutive snapshots per device
- Transit decrypt of both old and new ciphertext before diffing in memory
- Best-effort pattern: decrypt/DB failures logged and counted, never block snapshot ack
- Prometheus metrics track diff success, errors (by type), and generation duration
- Subscriber wired to call diff generation after every successful snapshot INSERT

## Task Commits

Each task was committed atomically:

1. **Task 1: Diff generation service (TDD RED)** - `79453fa` (test)
2. **Task 1: Diff generation service (TDD GREEN)** - `72d0ae2` (feat)
3. **Task 2: Wire diff into subscriber** - `eb76343` (feat)

_TDD task had separate RED and GREEN commits_

## Files Created/Modified
- `backend/app/services/config_diff_service.py` - Diff generation with Transit decrypt, difflib, Prometheus metrics
- `backend/tests/test_config_diff_service.py` - 5 unit tests covering diff, first-snapshot, decrypt failure, line counts, empty diff
- `backend/app/services/config_snapshot_subscriber.py` - Added RETURNING id, generate_and_store_diff call after commit
- `backend/tests/test_config_snapshot_subscriber.py` - Updated to mock generate_and_store_diff

## Decisions Made
- Diff service instantiates its own OpenBaoTransitService per-call (clean lifecycle, consistent with subscriber pattern)
- RETURNING id added to snapshot INSERT SQL to capture the new_snapshot_id without a separate query
- Subscriber tests mock generate_and_store_diff to keep snapshot tests isolated and unchanged in assertion counts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated subscriber test assertions for diff integration**
- **Found during:** Task 2 (wire diff into subscriber)
- **Issue:** Existing subscriber tests failed because generate_and_store_diff made additional DB calls through the shared mock session
- **Fix:** Added patch for generate_and_store_diff in subscriber tests that successfully INSERT (test 1 and test 6)
- **Files modified:** backend/tests/test_config_snapshot_subscriber.py
- **Verification:** All 11 tests pass
- **Committed in:** eb76343 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary to maintain test isolation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Diff generation is active and will produce diffs for every new non-duplicate snapshot
- router_config_diffs table populated with diff_text, line counts, and snapshot references
- Ready for change parser (Phase 6) to parse semantic changes from diff_text

---
*Phase: 05-diff-engine*
*Completed: 2026-03-13*
