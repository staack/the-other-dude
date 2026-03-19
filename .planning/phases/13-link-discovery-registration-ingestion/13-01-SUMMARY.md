---
phase: 13-link-discovery-registration-ingestion
plan: 01
subsystem: poller
tags: [routeros, nats, interfaces, mac-address, link-discovery, go]

requires:
  - phase: 12-wireless-registration-collection
    provides: "NATS publisher pattern, WIRELESS_REGISTRATIONS stream, withTimeout wrapper"
provides:
  - "InterfaceInfo struct with name, MAC, type, running fields"
  - "CollectInterfaceInfo function for RouterOS /interface/print"
  - "DeviceInterfaceEvent NATS publisher on device.interfaces.{device_id}"
  - "DEVICE_EVENTS stream includes device.interfaces.> subject"
affects: [13-link-discovery-registration-ingestion, link-state-machine, topology-map]

tech-stack:
  added: []
  patterns: [interface-identity-collector, mac-normalization]

key-files:
  created:
    - poller/internal/device/interfaces.go
    - poller/internal/device/interfaces_test.go
  modified:
    - poller/internal/bus/publisher.go
    - poller/internal/poller/worker.go

key-decisions:
  - "MAC addresses lowercased at collection time for consistent downstream matching"
  - "Entries without mac-address skipped (loopback, bridge without MAC)"
  - "Interface info collected separately from traffic counters (InterfaceInfo vs InterfaceStats)"

patterns-established:
  - "MAC normalization: all MAC addresses lowercased at the collection layer before publishing"
  - "InterfaceInfo vs InterfaceStats: identity data (link discovery) separate from traffic counters (metrics)"

requirements-completed: [LINK-01]

duration: 5min
completed: 2026-03-19
---

# Phase 13 Plan 01: Interface Info Collector Summary

**Go poller InterfaceInfo collector publishing MAC addresses to DEVICE_EVENTS NATS stream for link discovery**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T11:00:38Z
- **Completed:** 2026-03-19T11:06:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- InterfaceInfo struct and CollectInterfaceInfo function collect name, MAC, type, running from /interface/print
- MAC addresses lowercased at collection time for consistent downstream link resolution
- DeviceInterfaceEvent publisher sends to device.interfaces.{device_id} on DEVICE_EVENTS stream
- Wired into PollDevice cycle after traffic counters, before health metrics

## Task Commits

Each task was committed atomically:

1. **Task 1: Create interface info collector with v6/v7 routing** - `4b5bb94` (test) + `6939584` (feat)
2. **Task 2: Add DeviceInterfaceEvent publisher, update DEVICE_EVENTS stream, wire into PollDevice** - `397a33a` (feat)

_Note: Task 1 used TDD with separate test and implementation commits_

## Files Created/Modified
- `poller/internal/device/interfaces.go` - InterfaceInfo struct, CollectInterfaceInfo function, MAC normalization (added alongside existing InterfaceStats)
- `poller/internal/device/interfaces_test.go` - Unit tests for struct fields, MAC lowercasing, running bool parsing
- `poller/internal/bus/publisher.go` - DeviceInterfaceEvent type, PublishDeviceInterfaces method, device.interfaces.> added to DEVICE_EVENTS stream
- `poller/internal/poller/worker.go` - Interface info collection wired into PollDevice after traffic counters

## Decisions Made
- MAC addresses lowercased at collection time (strings.ToLower) so downstream consumers never need to normalize
- Entries without mac-address are silently skipped (loopback, bridge without MAC are not useful for link discovery)
- InterfaceInfo is a separate type from InterfaceStats -- identity data for link discovery vs traffic counters for metrics
- Collection placed after traffic counters, before health metrics in PollDevice to group interface-related work

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored InterfaceStats collector overwritten during file creation**
- **Found during:** Task 1
- **Issue:** Creating interfaces.go overwrote the pre-existing InterfaceStats type and CollectInterfaces function that publisher.go and worker.go depend on
- **Fix:** Restored InterfaceStats and CollectInterfaces, appended new InterfaceInfo types below
- **Files modified:** poller/internal/device/interfaces.go
- **Verification:** go build ./... succeeds
- **Committed in:** 6939584 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** File creation overwrote existing code; restored immediately. No scope creep.

## Issues Encountered
None beyond the deviation noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Interface MAC data now published to NATS on every poll cycle
- Backend subscriber (Plan 03) can consume device.interfaces.> to populate device_interfaces table
- Link discovery (Plan 02) can match registration MACs against interface MACs for topology resolution

## Self-Check: PASSED

All 4 files verified present. All 3 commits verified in git log.

---
*Phase: 13-link-discovery-registration-ingestion*
*Completed: 2026-03-19*
