---
phase: 19-fleet-ui-bulk-add
plan: 02
subsystem: ui
tags: [react, tabs, snmp, routeros, bulk-add, credential-profiles, tanstack-query]

# Dependency graph
requires:
  - phase: 19-fleet-ui-bulk-add/01
    provides: API types for credential profiles, SNMP profiles, bulk add with profile
  - phase: 17-snmp-api
    provides: Backend credential profile and bulk add endpoints
provides:
  - Three-tab Add Device dialog (RouterOS, SNMP, VPN) with credential profile support
  - Reusable BulkAddForm component for IP list bulk operations
  - SNMP single-device add form with version selector and device profile
affects: [19-fleet-ui-bulk-add/03, 19-fleet-ui-bulk-add/04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-tab device dialog with conditional VPN tab"
    - "Credential profile selector pattern for both RouterOS and SNMP"
    - "BulkAddForm reusable component with deviceType prop"
    - "IP list textarea parser with deduplication"

key-files:
  created:
    - frontend/src/components/fleet/BulkAddForm.tsx
  modified:
    - frontend/src/components/fleet/AddDeviceForm.tsx

key-decisions:
  - "Always-visible tabs (RouterOS, SNMP, VPN) instead of conditional two-tab layout"
  - "SNMP credential profile required (no manual SNMP credential entry) for security"
  - "RouterOS tab retains manual credential fallback for backward compatibility"
  - "IP parsing v1 handles one-per-line only; CIDR and range expansion deferred as TODO"
  - "snmpProfilesApi.list returns array or object with profiles field -- handled both shapes"

patterns-established:
  - "BulkAddForm accepts deviceType prop and adapts its fields (SNMP port/profile vs API ports)"
  - "Credential profile dropdowns filter by credential_type matching device type"
  - "Status banner pattern shared across both single-add tabs"

requirements-completed: [MGMT-01, MGMT-02, MGMT-03, MGMT-05, UI-05]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 19 Plan 02: Add Device Dialog + Bulk Add Summary

**Three-tab Add Device dialog (RouterOS/SNMP/VPN) with credential profile selectors and reusable BulkAddForm for IP list bulk operations**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T00:54:28Z
- **Completed:** 2026-03-22T00:59:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Redesigned Add Device dialog from conditional two-tab to always-visible three-tab layout (RouterOS, SNMP, VPN)
- RouterOS tab supports both credential profile mode and manual credential entry with "Add Multiple" toggle
- SNMP tab with version selector (v2c/v3), credential profile, device profile, and port configuration
- Created reusable BulkAddForm component for pasting IP lists with per-device result feedback

## Task Commits

Each task was committed atomically:

1. **Task 1: Redesign AddDeviceForm with three tabs and credential profile selectors** - `74ddaad` (feat)
2. **Task 2: Create BulkAddForm component for IP list bulk operations** - `caf1435` (feat)

## Files Created/Modified
- `frontend/src/components/fleet/AddDeviceForm.tsx` - Three-tab dialog with RouterOS, SNMP, VPN tabs and credential profile support
- `frontend/src/components/fleet/BulkAddForm.tsx` - Reusable bulk-add component with IP textarea, credential profile, and per-device results

## Decisions Made
- Always-visible tabs instead of conditional layout -- simpler UX, consistent with three device types
- SNMP tab requires a credential profile (no manual SNMP credential entry) for operational security
- RouterOS tab retains manual credential fallback for backward compatibility with existing workflows
- IP parsing v1 supports one-per-line only; CIDR and range expansion deferred with TODO comments
- BulkAddForm handles both array and object shapes from snmpProfilesApi.list for resilience

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] API types already existed from 19-01 commits**
- **Found during:** Task 1 (reading api.ts for types)
- **Issue:** Plan expected types might not exist from 19-01, but they were already committed
- **Fix:** Used existing types directly instead of adding placeholder comments
- **Files modified:** None (types already present)
- **Verification:** TypeScript compiles cleanly
- **Committed in:** N/A (no changes needed)

---

**Total deviations:** 1 auto-acknowledged (1 blocking -- resolved by prior plan)
**Impact on plan:** No scope creep. Prior plan completion simplified this plan's execution.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Add Device dialog fully functional with three tabs
- BulkAddForm ready to be used from both RouterOS and SNMP tabs
- Credential profile management UI (from 19-01/19-03) provides the profiles these forms consume
- Ready for 19-03 (credential profile management page) and 19-04 (device list filtering)

## Self-Check: PASSED

- [x] AddDeviceForm.tsx exists
- [x] BulkAddForm.tsx exists
- [x] Commit 74ddaad found
- [x] Commit caf1435 found
- [x] TypeScript compiles with no errors

---
*Phase: 19-fleet-ui-bulk-add*
*Completed: 2026-03-22*
