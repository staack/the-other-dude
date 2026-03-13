---
phase: 05-diff-engine
plan: 02
subsystem: api
tags: [parser, routeros, structured-changes, tdd]

requires:
  - phase: 05-diff-engine
    plan: 01
    provides: "generate_and_store_diff() and router_config_diffs table"
provides:
  - "parse_diff_changes() for extracting structured component changes from unified diffs"
  - "router_config_changes rows linked to diff_id for timeline UI"
affects: [07-timeline-api]

tech-stack:
  added: []
  patterns: [tdd-red-green, best-effort-secondary-operation]

key-files:
  created:
    - backend/app/services/config_change_parser.py
    - backend/tests/test_config_change_parser.py
  modified:
    - backend/app/services/config_diff_service.py
    - backend/tests/test_config_diff_service.py

key-decisions:
  - "Change parser is pure function (no DB/IO) for easy testing; DB writes happen in diff service"
  - "RETURNING id added to diff INSERT to capture diff_id for linking changes"
  - "Change parser errors are best-effort: diff is always stored, only changes are lost on parser failure"

patterns-established:
  - "RouterOS path to component: strip leading /, replace spaces with / (e.g., /ip firewall filter -> ip/firewall/filter)"
  - "Fallback component system/general for diffs without RouterOS path headers"

requirements-completed: [DIFF-03, DIFF-04]

duration: 2min
completed: 2026-03-13
---

# Phase 5 Plan 2: Structured Change Parser Summary

**RouterOS diff change parser extracting component names, human-readable summaries, and raw lines from unified diffs with best-effort DB storage**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T03:34:48Z
- **Completed:** 2026-03-13T03:37:14Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Pure-function change parser extracts component, summary, raw_line from RouterOS unified diffs
- RouterOS path detection converts section headers to component format (ip/firewall/filter)
- Human-readable summaries: Added/Removed/Modified N rules per component
- Diff service wired to call parser after INSERT and store results in router_config_changes
- Parser failures are best-effort: diff always stored, changes lost only on parser error

## Task Commits

Each task was committed atomically:

1. **Task 1: Change parser TDD RED** - `7fddf35` (test)
2. **Task 1: Change parser TDD GREEN** - `b167831` (feat)
3. **Task 2: Wire parser into diff service** - `122b591` (feat)

_TDD task had separate RED and GREEN commits_

## Files Created/Modified
- `backend/app/services/config_change_parser.py` - Pure parser: parse_diff_changes() with path detection, summary generation, raw line capture
- `backend/tests/test_config_change_parser.py` - 6 unit tests covering additions, multi-section, removals, modifications, fallback, raw_line
- `backend/app/services/config_diff_service.py` - Added RETURNING id, parse_diff_changes integration, change INSERT loop
- `backend/tests/test_config_diff_service.py` - Updated existing tests for RETURNING id, added 2 tests for change storage and parser error resilience

## Decisions Made
- Change parser is a pure function (no DB/IO) for straightforward unit testing; DB writes are the diff service's responsibility
- RETURNING id added to diff INSERT SQL to get diff_id without separate query
- Change parser errors caught by separate try/except so diff is always committed first

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing diff service tests for RETURNING id and parse_diff_changes integration**
- **Found during:** Task 2
- **Issue:** Existing tests expected 3 execute calls without scalar_one on INSERT result; new RETURNING id and parse_diff_changes call changed the interaction pattern
- **Fix:** Added scalar_one mock to INSERT result, patched parse_diff_changes to return empty list in existing tests to isolate behavior
- **Files modified:** backend/tests/test_config_diff_service.py
- **Committed in:** 122b591

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary test update for API change. No scope creep.

## Issues Encountered
None

## User Setup Required
None

## Next Phase Readiness
- router_config_changes table populated with structured changes for every non-empty diff
- Changes linked to diff_id, device_id, tenant_id for timeline queries
- Ready for timeline API (Phase 7) to query changes per device

---
*Phase: 05-diff-engine*
*Completed: 2026-03-13*
