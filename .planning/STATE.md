---
gsd_state_version: 1.0
milestone: v9.7
milestone_name: Tower & Site Management
status: unknown
stopped_at: Completed 14-03-PLAN.md
last_updated: "2026-03-19T11:55:25.846Z"
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 11
  completed_plans: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Operators can monitor, configure, and troubleshoot their entire MikroTik fleet from a single pane of glass
**Current focus:** Phase 14 — site-dashboard-sector-views-wireless-ui

## Current Position

Phase: 14 (site-dashboard-sector-views-wireless-ui) — EXECUTING
Plan: 3 of 3

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: 3 min
- Total execution time: 0.35 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 11 | 3 | 12min | 4min |
| 12 | 2 | 6min | 3min |
| 13 | 2 | 5min | 2.5min |
| Phase 13 P01 | 5min | 2 tasks | 4 files |
| Phase 13 P03 | 3min | 2 tasks | 6 files |
| Phase 14 P01 | 3min | 2 tasks | 15 files |
| Phase 14 P02 | 3min | 2 tasks | 9 files |
| Phase 14 P03 | 3min | 2 tasks | 6 files |

## Accumulated Context

| Phase 11 P01 | 3min | 2 tasks | 9 files |
| Phase 11 P02 | 6min | 3 tasks | 8 files |
| Phase 11 P03 | 3min | 2 tasks | 5 files |
| Phase 12 P01 | 3min | 2 tasks | 6 files |
| Phase 12 P02 | 3min | 2 tasks | 3 files |
| Phase 13 P01 | 3min | 2 tasks | 6 files |
| Phase 13 P02 | 2min | 2 tasks | 5 files |

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

- Sites must use nullable site_id FK (never mandatory) to preserve flat-list workflow
- Per-client wireless data gets its own NATS stream and hypertable (not DEVICE_EVENTS or wireless_metrics)
- Link state machine requires 3 consecutive missed polls before marking down (prevents false flapping)
- [Phase 11]: alert_count set to 0 with TODO -- alert_events integration deferred to avoid coupling
- [Phase 11]: Site detail page kept minimal (info + stats) -- full dashboard deferred to Phase 14
- [Phase 11]: Used Dialog for delete confirmation (no AlertDialog component in UI library)
- [Phase 11]: Site column placed after Model in fleet table for logical grouping
- [Phase 11]: Viewers see site name text, operators get Select dropdown for assignment
- [Phase 12]: Used unified tenant_isolation RLS policy with super_admin OR clause (matching codebase convention) instead of separate super_admin_bypass policy
- [Phase 12]: WIRELESS_REGISTRATIONS NATS stream uses 30-day retention (vs 24h for DEVICE_EVENTS) for historical client analytics
- [Phase 12]: RF monitor collection gated on wireless interface presence to avoid unnecessary API calls
- [Phase 13]: No backref on DeviceInterface.device relationship -- link discovery reads interfaces directionally
- [Phase 13]: MAC addresses lowercased at collection time for consistent downstream matching
- [Phase 13]: InterfaceInfo (identity/link discovery) kept separate from InterfaceStats (traffic counters)
- [Phase 13]: Link discovery uses separate durable consumer on WIRELESS_REGISTRATIONS for independent processing
- [Phase 13]: Unknown clients query uses DISTINCT ON (mac_address) for most recent data per MAC
- [Phase 14]: Sector CRUD nested under sites path (/sites/{sid}/sectors) matching REST hierarchy
- [Phase 14]: Device sector assignment uses PUT /devices/{did}/sector with nullable sector_id for set/clear
- [Phase 14]: Wireless registration queries join device_interfaces for MAC-to-hostname resolution
- [Phase 14]: Shared signalColor helper in separate module for reuse across wireless components
- [Phase 14]: Wireless links grouped by AP hostname with nested CPE rows for topology clarity
- [Phase 14]: Sidebar Wireless Links href is tenant-scoped for non-super_admin users
- [Phase 14]: Used fleet summary API for CPU/memory data since devicesApi.list does not return health metrics

### Pending Todos

None yet.

### Blockers/Concerns

- OpenBao dev instance loses Transit keys on data wipe — device creds need re-entry
- RouterOS 7 WiFi registration-table field names need validation on real hardware (Phase 12)
- MAC-to-device resolution data source needs codebase audit (Phase 13)

## Session Continuity

Last session: 2026-03-19T11:55:25.843Z
Stopped at: Completed 14-03-PLAN.md
Resume file: None
