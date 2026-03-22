# Roadmap: TOD v9.8 — SNMP Device Integration

## Overview

v9.8 extends TOD from a MikroTik-only fleet manager into a multi-vendor NMS by adding SNMP device monitoring alongside the existing RouterOS API path. The build follows a strict dependency chain: schema foundation and credential refactor first (must be backward-compatible with existing RouterOS flow), then backend API and NATS subscriber extension (must deploy before poller publishes SNMP events), then the SNMP collector in the Go poller, then frontend integration with bulk add, and finally the advanced custom profile builder with MIB upload. Each phase delivers a coherent capability that unblocks the next.

## Milestones

- v9.6 Config Backup - Phases 1-10 (shipped)
- v9.7 Tower & Site Management - Phases 11-15 (shipped 2026-03-19)
- v9.8 SNMP Device Integration - Phases 16-20 (in progress)

## Phases

<details>
<summary>v9.6 Config Backup & Change Tracking (Phases 1-10)</summary>

- [x] **Phase 1: Database Schema** - Config snapshot, diff, and change tables with encryption and RLS
- [x] **Phase 2: Poller Config Collection** - SSH export, normalization, and NATS publishing from Go poller
- [x] **Phase 3: Snapshot Ingestion** - Backend NATS subscriber stores snapshots with SHA256 deduplication
- [x] **Phase 4: Manual Backup Trigger** - API endpoint for on-demand config backup via poller
- [x] **Phase 5: Diff Engine** - Unified diff generation and structured change parsing
- [x] **Phase 6: History API** - REST endpoints for timeline, snapshot view, and diff retrieval with RBAC
- [x] **Phase 7: Config History UI** - Timeline section on device page with change summaries
- [x] **Phase 8: Diff Viewer & Download** - Unified diff display with syntax highlighting and .rsc download
- [x] **Phase 9: Retention & Cleanup** - 90-day retention policy with automatic snapshot deletion
- [x] **Phase 10: Audit & Observability** - Audit event logging for all config backup operations

</details>

<details>
<summary>v9.7 Tower & Site Management (Phases 11-15) - SHIPPED 2026-03-19</summary>

- [x] **Phase 11: Site Data Model + Foundation** - Sites CRUD, device assignment, site list with health rollup
- [x] **Phase 12: Per-Client Wireless Collection** - Poller extension to collect registration table and per-interface RF stats
- [x] **Phase 13: Link Discovery + Registration Ingestion** - Backend NATS consumer, MAC resolution, AP-CPE link state machine
- [x] **Phase 14: Site Dashboard + Sector Views + Wireless UI** - Site detail page, sector-centric view, per-station wireless tables
- [x] **Phase 15: Signal Trending + Site Alerting** - Signal history charts, degradation detection, site/sector alert rules

</details>

### v9.8 SNMP Device Integration (Phases 16-20)

- [x] **Phase 16: Schema Foundation + Credential Refactor** - Database migrations, Collector interface, credential cache backward-compatible refactor (completed 2026-03-21)
- [x] **Phase 17: Backend API + Subscriber Extension** - Credential profile and SNMP profile CRUD APIs, snmp_custom subscriber handler, NAK safety net (completed 2026-03-22)
- [x] **Phase 18: SNMP Collector Core** - gosnmp polling, profile-driven OID collection, counter delta computation, auto-detection (completed 2026-03-22)
- [x] **Phase 19: Fleet UI + Bulk Add** - SNMP devices in fleet table, device detail, add device dialog, bulk add, credential profile management (completed 2026-03-22)
- [x] **Phase 20: Custom Profile Builder + MIB Upload** - MIB file upload, OID tree browser, profile editor, test profile against live device (completed 2026-03-22)

## Phase Details

### Phase 16: Schema Foundation + Credential Refactor
**Goal**: Database schema supports SNMP devices, credential profiles, and device profiles; poller Collector interface enables protocol dispatch; credential cache refactor is backward-compatible with all existing RouterOS polling
**Depends on**: Nothing (first phase of v9.8; existing v9.7 foundation)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, CRED-04, CRED-05, COMPAT-01, COMPAT-02, COMPAT-03
**Success Criteria** (what must be TRUE):
  1. Database has credential_profiles, snmp_profiles, and snmp_metrics tables; devices table has device_type, snmp_profile_id, and credential_profile_id columns
  2. All existing RouterOS devices continue to poll, store metrics, and display in the UI identically to before the migration (zero regression)
  3. Poller dispatches to RouterOSCollector or SNMPCollector based on device_type, with RouterOSCollector wrapping existing PollDevice logic without behavior changes
  4. Credential cache resolves credentials via fallback chain (per-device first, then credential profile) and handles legacy credentials without a type field as routeros
  5. Six system-shipped SNMP profiles (generic-snmp, network-switch, network-router, wireless-ap, ups-device, mikrotik-snmp) exist in the snmp_profiles table
**Plans:** 4/4 plans complete

Plans:
- [x] 16-01-PLAN.md -- Database migrations (credential_profiles, snmp_profiles with seeds, devices columns, snmp_metrics hypertable)
- [x] 16-02-PLAN.md -- Go store.Device struct + FetchDevices query update with credential profile JOIN
- [x] 16-03-PLAN.md -- Credential cache refactor (GetRawCredentials, type parsers, backward-compat wrapper)
- [x] 16-04-PLAN.md -- Collector interface, RouterOSCollector wrapper, Scheduler dispatch by device_type

### Phase 17: Backend API + Subscriber Extension
**Goal**: Python backend exposes credential profile and SNMP profile CRUD APIs with encrypted storage; NATS subscriber handles snmp_custom events; backend is fully deployed and ready before poller ships SNMP code
**Depends on**: Phase 16 (schema tables must exist; credential_profiles and snmp_profiles tables are FK dependencies)
**Requirements**: CRED-01, CRED-02, CRED-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. Operator can create, list, edit, and delete credential profiles (RouterOS and SNMP types) with credentials encrypted via OpenBao Transit
  2. Operator can assign a credential profile to devices, and updating the profile propagates new credentials to all linked devices on next poll cycle
  3. Deleting a credential profile that has linked devices returns HTTP 409 with a count of affected devices (no silent orphaning)
  4. NATS metrics_subscriber processes snmp_custom events and inserts rows into snmp_metrics hypertable; unknown event types are NAKed instead of ACKed
  5. SNMP metrics API returns time-bucketed data in the same format as existing metrics endpoints
**Plans:** 3/3 plans complete

Plans:
- [x] 17-01-PLAN.md -- Credential profile CRUD API with OpenBao Transit encryption, deletion protection, device assignment
- [x] 17-02-PLAN.md -- SNMP profile CRUD API, metrics_subscriber snmp_custom handler, NAK safety net, SNMP metrics query endpoint
- [x] 17-03-PLAN.md -- Bulk device add API with credential profile support for RouterOS and SNMP devices

### Phase 18: SNMP Collector Core
**Goal**: Poller polls SNMP devices end-to-end -- standard metrics flow into existing hypertables, custom metrics flow into snmp_metrics, and auto-detection identifies device profiles via sysObjectID
**Depends on**: Phase 17 (backend subscriber must be deployed and processing snmp_custom events before poller publishes them; credential profile and SNMP profile APIs must be live)
**Requirements**: POLL-01, POLL-02, POLL-03, POLL-04, POLL-05, POLL-06, POLL-07, DATA-01, DATA-02, DATA-03, PROF-01, PROF-02, COMPAT-04
**Success Criteria** (what must be TRUE):
  1. Poller polls SNMP devices using SNMPv1, v2c, and v3 with correct authentication and encryption
  2. Standard SNMP interface metrics (rx_bytes, tx_bytes, rx_bps, tx_bps from ifXTable) appear in the existing interface_metrics hypertable alongside RouterOS interface data
  3. Standard SNMP health metrics (CPU, memory, disk from HOST-RESOURCES-MIB) appear in the existing health_metrics hypertable alongside RouterOS health data
  4. Custom OID data from device profiles publishes as snmp_custom events and lands in the snmp_metrics hypertable with correct metric_name, metric_group, oid, and value
  5. Auto-detection probes a device's sysObjectID via NATS request-reply and suggests a matching system profile (or generic-snmp fallback)
**Plans:** 5/5 plans complete

Plans:
- [ ] 18-01-PLAN.md -- gosnmp dependency, SNMP client builder, counter cache, SNMPMetricsEvent struct
- [ ] 18-02-PLAN.md -- ProfileCache with DB loading, JSONB compilation, sysObjectID prefix matching
- [ ] 18-03-PLAN.md -- SNMPCollector.Collect with profile-driven OID collection, mappers, event publishing
- [ ] 18-04-PLAN.md -- DiscoveryResponder for SNMP auto-detection via NATS request-reply
- [ ] 18-05-PLAN.md -- Scheduler registration, main.go wiring, SoftwareVersion field

### Phase 19: Fleet UI + Bulk Add
**Goal**: SNMP devices appear alongside MikroTik devices as first-class citizens in the UI; operators can add devices individually or in bulk using credential profiles
**Depends on**: Phase 18 (SNMP data must be flowing into the database for the UI to display; Phase 17 APIs for credential profiles and SNMP profiles must be live)
**Requirements**: MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05, UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, DATA-05
**Success Criteria** (what must be TRUE):
  1. Fleet table shows SNMP devices alongside MikroTik devices with a type icon, and operators can filter by device type (All / RouterOS / SNMP)
  2. SNMP device detail page shows system info, interface traffic charts, health metrics charts, and custom OID charts -- with no RouterOS-only sections visible
  3. Add Device dialog has tabs for RouterOS, SNMP, and VPN with credential profile selectors filtered by device type
  4. Operator can bulk-add RouterOS or SNMP devices using a credential profile + IP list (one per line, CIDR, or range) and receives per-device results with success/failure reasons
  5. Credential profile management page lists, creates, edits, and deletes profiles for both RouterOS and SNMP types
**Plans:** 4/4 plans complete

Plans:
- [ ] 19-01-PLAN.md -- API client SNMP types + fleet table type icon + device type filter
- [ ] 19-02-PLAN.md -- Add Device dialog redesign (RouterOS/SNMP/VPN tabs, credential profiles, bulk add)
- [ ] 19-03-PLAN.md -- Credential profile management page (CRUD, Settings route)
- [ ] 19-04-PLAN.md -- Device detail conditional rendering + SNMP metrics section

### Phase 20: Custom Profile Builder + MIB Upload
**Goal**: Power users can upload vendor MIB files, browse OID trees, build custom SNMP profiles, and test profiles against live devices before saving
**Depends on**: Phase 19 (standard SNMP monitoring path must be solid and the SNMP profile editor page must exist in navigation; Phase 18 SNMP collector must support custom profiles)
**Requirements**: PROF-03, PROF-04, PROF-05, UI-07
**Success Criteria** (what must be TRUE):
  1. Operator can upload vendor MIB files and the system parses them into a browsable OID tree with descriptions, types, and access modes
  2. OID tree browser lets operators expand/collapse MIB nodes and select OIDs to add to a custom profile's collection targets
  3. Operator can create custom SNMP profiles with arbitrary OID collections organized by poll group (e.g., fast 60s, standard 5m, slow 30m)
  4. Operator can test a custom profile against a live device and see actual OID values returned before committing the profile
**Plans:** 3/3 plans complete

Plans:
- [ ] 20-01-PLAN.md -- Go CLI binary (tod-mib-parser) using gosmi for MIB file parsing
- [ ] 20-02-PLAN.md -- Backend parse-mib endpoint (subprocess to Go binary) and test-profile endpoint (NATS request-reply)
- [ ] 20-03-PLAN.md -- Frontend SNMP profile editor page with OID tree browser, poll group config, test panel

## Coverage

| Category | Requirements | Phase | Count |
|----------|-------------|-------|-------|
| Foundation | FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06 | 16 | 6 |
| Credentials | CRED-01, CRED-02, CRED-03 | 17 | 3 |
| Credentials | CRED-04, CRED-05 | 16 | 2 |
| SNMP Polling | POLL-01, POLL-02, POLL-03, POLL-04, POLL-05, POLL-06, POLL-07 | 18 | 5/5 | Complete    | 2026-03-22 | PROF-01, PROF-02 | 18 | 2 |
| Device Profiles | PROF-03, PROF-04, PROF-05 | 20 | 3/3 | Complete   | 2026-03-22 | MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05 | 19 | 4/4 | Complete    | 2026-03-22 | UI-01, UI-02, UI-03, UI-04, UI-05, UI-06 | 19 | 6 |
| Fleet UI | UI-07 | 20 | 1 |
| Metrics & Data | DATA-01, DATA-02, DATA-03 | 18 | 3 |
| Metrics & Data | DATA-04 | 17 | 1 |
| Metrics & Data | DATA-05 | 19 | 1 |
| Backward Compat | COMPAT-01, COMPAT-02, COMPAT-03 | 16 | 3 |
| Backward Compat | COMPAT-04 | 18 | 1 |
| **Total** | | | **44** |

## Progress

**Execution Order:**
Phases execute in numeric order: 16 -> 16.x -> 17 -> 17.x -> 18 -> 18.x -> 19 -> 19.x -> 20

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 16. Schema Foundation + Credential Refactor | 4/4 | Complete | 2026-03-21 |
| 17. Backend API + Subscriber Extension | 3/3 | Complete | 2026-03-22 |
| 18. SNMP Collector Core | 0/5 | Not started | - |
| 19. Fleet UI + Bulk Add | 0/4 | Not started | - |
| 20. Custom Profile Builder + MIB Upload | 0/3 | Not started | - |

---
*Roadmap created: 2026-03-21*
*Last updated: 2026-03-22*
