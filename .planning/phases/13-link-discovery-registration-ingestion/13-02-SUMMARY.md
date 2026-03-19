---
phase: 13-link-discovery-registration-ingestion
plan: 02
subsystem: database
tags: [alembic, sqlalchemy, rls, wireless-links, device-interfaces, postgres]

requires:
  - phase: 12-wireless-registration-collection
    provides: wireless_registrations hypertable and NATS stream
provides:
  - device_interfaces table with MAC-to-device resolution index
  - wireless_links table with link state machine columns
  - DeviceInterface and WirelessLink ORM models
  - LinkState enum (discovered/active/degraded/down/stale)
affects: [13-link-discovery-registration-ingestion]

tech-stack:
  added: []
  patterns: [link state machine with missed_polls counter, MAC-indexed interface table]

key-files:
  created:
    - backend/alembic/versions/032_device_interfaces_table.py
    - backend/alembic/versions/033_wireless_links_table.py
    - backend/app/models/device_interface.py
    - backend/app/models/wireless_link.py
  modified:
    - backend/app/models/__init__.py

key-decisions:
  - "No backref on DeviceInterface.device relationship -- link discovery reads interfaces, does not navigate from Device to interfaces"

patterns-established:
  - "LinkState enum: discovered -> active -> degraded -> down -> stale state machine for wireless link health"
  - "MAC-indexed interface table pattern for cross-device MAC resolution"

requirements-completed: [LINK-02, LINK-03]

duration: 2min
completed: 2026-03-19
---

# Phase 13 Plan 02: Database Schema Summary

**Alembic migrations and SQLAlchemy models for device_interfaces (MAC resolution) and wireless_links (AP-CPE state tracking) tables with RLS**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-19T11:00:46Z
- **Completed:** 2026-03-19T11:02:22Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- device_interfaces table with MAC index for link discovery MAC-to-device resolution
- wireless_links table with state machine columns (state, missed_polls) for AP-CPE tracking
- Both tables have tenant isolation RLS matching codebase convention
- DeviceInterface and WirelessLink models registered in app.models with LinkState enum

## Task Commits

Each task was committed atomically:

1. **Task 1: Create device_interfaces table migration and ORM model** - `7147b15` (feat)
2. **Task 2: Create wireless_links table migration, ORM model, and register both models** - `a71df2a` (feat)

## Files Created/Modified
- `backend/alembic/versions/032_device_interfaces_table.py` - device_interfaces table with RLS, MAC index, unique(device_id, name)
- `backend/alembic/versions/033_wireless_links_table.py` - wireless_links table with state machine, missed_polls, 4 indexes, RLS
- `backend/app/models/device_interface.py` - DeviceInterface ORM model with device relationship
- `backend/app/models/wireless_link.py` - WirelessLink ORM model with LinkState enum, ap_device/cpe_device relationships
- `backend/app/models/__init__.py` - Added DeviceInterface, WirelessLink, LinkState to model registry

## Decisions Made
- No backref on DeviceInterface.device relationship -- link discovery reads interfaces directionally, no need to navigate from Device to its interfaces via ORM

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- device_interfaces and wireless_links tables ready for Plan 03's link discovery subscriber
- LinkState enum available for state machine logic in the NATS subscriber
- MAC index on device_interfaces enables efficient MAC-to-device lookups

---
*Phase: 13-link-discovery-registration-ingestion*
*Completed: 2026-03-19*
