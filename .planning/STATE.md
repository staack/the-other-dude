---
gsd_state_version: 1.0
milestone: v9.8
milestone_name: SNMP Device Integration
status: unknown
stopped_at: Completed 19-02-PLAN.md (Add Device dialog + Bulk Add)
last_updated: "2026-03-22T01:01:06.013Z"
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 16
  completed_plans: 15
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Operators can monitor their entire network fleet -- MikroTik and SNMP devices side by side -- from a single pane of glass
**Current focus:** Phase 19 — Fleet UI + Bulk Add

## Current Position

Phase: 19 (Fleet UI + Bulk Add) — EXECUTING
Plan: 4 of 4

## Performance Metrics

**Velocity:** (from v9.7)

- Total plans completed: 14
- Average duration: 3.4 min
- Total execution time: ~0.8 hours

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

- [v9.8] gosnmp in existing poller (not sidecar) -- unified device lifecycle
- [v9.8] Unified credential_profiles table for RouterOS + SNMP
- [v9.8] Standard SNMP metrics reuse existing hypertables (zero frontend changes for standard data)
- [v9.8] Counter delta computed in poller (not SQL LAG) for wraparound handling
- [v9.8] MIB parser as Go CLI binary (gosmi), not Python PySMI
- [Phase 16]: Raw SQL migrations via sa.text() for tables needing RLS + GRANT + partial unique indexes
- [Phase 16]: SNMP profile seed data as Python dicts with shared group constants to avoid OID duplication
- [Phase 16]: GetDevice also updated with new columns so interactive commands have device_type for conditional behavior
- [Phase 16]: Raw bytes cache separate from parsed creds, keyed with source prefix to prevent device/profile poisoning
- [Phase 16]: Legacy no-type-field JSON treated as RouterOS for backward compat with all existing credentials
- [Phase 16]: RouterOSCollector delegates to PollDevice (no body move) for minimal diff and preserved test surface
- [Phase 16]: RouterOSCollector registered inside NewScheduler (no main.go changes)
- [Phase 16]: Empty DeviceType defaults to "routeros" for backward compat with existing devices
- [Phase 17]: NAK unknown metric types instead of ACK -- prevents permanent data loss during deployment ordering mismatches
- [Phase 17]: Exclude profile_data JSONB from list response -- separate detail endpoint for full profile data
- [Phase 17]: New credential writes always use OpenBao Transit (never legacy AES-GCM)
- [Phase 17]: Credential fields are write-only -- accepted on create/update, encrypted, never returned in responses
- [Phase 17]: Separate /devices/bulk endpoint from legacy /devices/bulk-add for backward compatibility
- [Phase 17]: Credential profile type must match device type (routeros for routeros, snmp_v* for snmp)
- [Phase 17]: TCP reachability check only for RouterOS devices; SNMP (UDP) skips it
- [Phase 18]: MaxRepetitions=10 (not gosnmp default 50) for embedded device safety
- [Phase 18]: Counter sanity threshold at 90% of max value to distinguish reset from wrap
- [Phase 18]: Counter state in Redis with 600s TTL, MGET/MSET pipelining for efficiency
- [Phase 18]: sysOIDMap sorted by prefix length descending at load time for O(n) longest-prefix matching
- [Phase 18]: Invalid profile_data rows logged and skipped rather than failing entire cache load
- [Phase 18]: Inline gosnmp client construction in DiscoveryResponder to avoid snmp->bus->snmp import cycle
- [Phase 18]: Local withTimeout generic helper in snmp package (poller.withTimeout is unexported)
- [Phase 18]: walkTable safety valve at 10,000 PDUs to prevent memory exhaustion from misbehaving devices
- [Phase 18]: Poll groups collect independently -- partial SNMP collection failures do not abort the cycle
- [Phase 18]: RegisterCollector method on Scheduler for external collector registration (minimal invasiveness)
- [Phase 18]: ProfileCache.Load failure non-fatal at startup (profiles refresh on next 5-min cycle)
- [Phase 18]: DiscoveryResponder.Start failure non-fatal (discovery is convenience, not required for polling)
- [Phase 19]: Dot-notation route (settings.credentials.tsx) matching existing api-keys pattern
- [Phase 19]: credentialProfilesApi types added to api.ts as forward-compatible stub (plan 19-01 backend not yet executed)
- [Phase 19]: Always-visible three-tab layout (RouterOS, SNMP, VPN) instead of conditional two-tab
- [Phase 19]: SNMP tab requires credential profile (no manual SNMP credential entry) for operational security
- [Phase 19]: IP parsing v1 handles one-per-line only; CIDR and range expansion deferred with TODO

### Pending Todos

None yet.

### Blockers/Concerns

- Backend metrics_subscriber must handle snmp_custom events BEFORE poller starts publishing them (deployment ordering -- Phase 17 before Phase 18)
- Credential cache shape change (GetRawCredentials) must be backward-compatible or breaks all RouterOS polling
- Counter32 wraparound on high-speed interfaces produces silently wrong rate data if not handled from day one
- gosnmp BulkWalk can hang indefinitely on misbehaving devices without explicit timeout wrapping

## Session Continuity

Last session: 2026-03-22T01:00:58.297Z
Stopped at: Completed 19-02-PLAN.md (Add Device dialog + Bulk Add)
Resume file: None
