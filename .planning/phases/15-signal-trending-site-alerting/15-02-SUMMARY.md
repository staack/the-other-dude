---
phase: 15-signal-trending-site-alerting
plan: 02
subsystem: api
tags: [asyncio, signal-trending, alerting, typescript, scheduled-tasks]

requires:
  - phase: 14-wireless-sector-management
    provides: wireless_links, sectors, devices with site_id
provides:
  - Hourly signal trend detection comparing 7d vs 14d averages
  - 5-minute alert rule evaluation with hysteresis for 4 rule types
  - Frontend API clients for signal history, alert rules, and alert events
affects: [15-signal-trending-site-alerting]

tech-stack:
  added: []
  patterns: [asyncio background task with getattr fallback for config, hysteresis via consecutive_hits counter]

key-files:
  created:
    - backend/app/services/trend_detector.py
    - backend/app/services/alert_evaluator_site.py
  modified:
    - backend/app/main.py
    - frontend/src/lib/api.ts

key-decisions:
  - "Used getattr with fallback for config settings (SIGNAL_DEGRADATION_THRESHOLD_DB etc.) so services work before Plan 01 adds them to Settings class"
  - "Trend detector derives site_id via JOIN on devices table since wireless_links has no direct site_id column"
  - "Alert events created with consecutive_hits=1 immediately; UI/API filters for >= 2 to show confirmed alerts"
  - "Severity auto-assigned: critical for device_offline rules, warning for sector signal/client rules"

patterns-established:
  - "Hysteresis pattern: create event at hits=1, confirm at hits>=2, auto-resolve when condition clears"
  - "Scheduled task pattern: getattr config fallback, AdminAsyncSessionLocal, raw SQL for cross-tenant system queries"

requirements-completed: [TRND-02, ALRT-01, ALRT-02]

duration: 3min
completed: 2026-03-19
---

# Phase 15 Plan 02: Signal Trending & Alert Evaluation Summary

**Hourly trend detection comparing 7d/14d signal averages plus 5-minute alert rule evaluation with hysteresis across 4 rule types, with TypeScript API clients for Plan 03 UI**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-19T12:14:19Z
- **Completed:** 2026-03-19T12:17:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Trend detector scans active/degraded wireless links hourly, creates signal_degradation alerts when 7d avg drops 5+ dB from 14d baseline
- Alert evaluator checks all enabled rules every 5 minutes with hysteresis (2 consecutive hits before confirming)
- Both tasks wired into lifespan with non-fatal startup and graceful cancel on shutdown
- Three frontend API clients (signalHistoryApi, alertRulesApi, alertEventsApi) ready for Plan 03 UI components

## Task Commits

Each task was committed atomically:

1. **Task 1: Create trend detection and alert evaluation scheduled tasks** - `c3ae48e` (feat)
2. **Task 2: Add frontend TypeScript API clients** - `b9a92f3` (feat)

## Files Created/Modified
- `backend/app/services/trend_detector.py` - Hourly signal trend detection loop
- `backend/app/services/alert_evaluator_site.py` - 5-minute alert rule evaluation with hysteresis
- `backend/app/main.py` - Wired both tasks into lifespan startup/shutdown
- `frontend/src/lib/api.ts` - Added signalHistoryApi, alertRulesApi, alertEventsApi clients

## Decisions Made
- Used getattr with fallback for config settings so services work before Plan 01 adds settings to the Settings class
- Derived site_id via JOIN on devices table since wireless_links has no direct site_id FK
- Alert events created immediately with consecutive_hits=1; confirmed when hits reach 2
- Auto-assigned severity: critical for device_offline rules, warning for sector-scoped rules

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Backend scheduled tasks ready for signal degradation detection and alert evaluation
- Frontend API clients ready for Plan 03 UI components (signal charts, alert rules tab, notification bell)
- Depends on Plan 01 completing first (database tables, config settings, router endpoints)

---
*Phase: 15-signal-trending-site-alerting*
*Completed: 2026-03-19*
