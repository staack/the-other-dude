# Roadmap: TOD v9.7 — Tower & Site Management

## Overview

v9.7 transforms TOD from a flat device list into a site-aware fleet management platform. The build follows strict data flow dependencies: site data model first (immediately useful, no poller changes), then per-client wireless collection in the Go poller, then backend ingestion and link discovery, then the full site dashboard and wireless UI, and finally signal trending and alerting which require accumulated data. Each phase delivers a coherent, verifiable capability that unblocks the next.

## Milestones

- **v9.6 Config Backup** - Phases 1-10 (in progress)
- **v9.7 Tower & Site Management** - Phases 11-15 (planned)

## Phases

<details>
<summary>v9.6 Config Backup & Change Tracking (Phases 1-10)</summary>

- [x] **Phase 1: Database Schema** - Config snapshot, diff, and change tables with encryption and RLS (completed 2026-03-13)
- [x] **Phase 2: Poller Config Collection** - SSH export, normalization, and NATS publishing from Go poller (completed 2026-03-13)
- [ ] **Phase 3: Snapshot Ingestion** - Backend NATS subscriber stores snapshots with SHA256 deduplication
- [x] **Phase 4: Manual Backup Trigger** - API endpoint for on-demand config backup via poller (completed 2026-03-13)
- [x] **Phase 5: Diff Engine** - Unified diff generation and structured change parsing (completed 2026-03-13)
- [x] **Phase 6: History API** - REST endpoints for timeline, snapshot view, and diff retrieval with RBAC (completed 2026-03-13)
- [x] **Phase 7: Config History UI** - Timeline section on device page with change summaries (completed 2026-03-13)
- [ ] **Phase 8: Diff Viewer & Download** - Unified diff display with syntax highlighting and .rsc download
- [x] **Phase 9: Retention & Cleanup** - 90-day retention policy with automatic snapshot deletion (completed 2026-03-13)
- [x] **Phase 10: Audit & Observability** - Audit event logging for all config backup operations (completed 2026-03-13)

</details>

### v9.7 Tower & Site Management (Phases 11-15)

**Phase Numbering:**
- Continues from v9.6 (ended at Phase 10)
- Integer phases (11, 12, 13): Planned milestone work
- Decimal phases (11.1, 11.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 11: Site Data Model + Foundation** - Sites CRUD, device assignment, site list with health rollup (completed 2026-03-19)
- [x] **Phase 12: Per-Client Wireless Collection** - Poller extension to collect registration table and per-interface RF stats (completed 2026-03-19)
- [x] **Phase 13: Link Discovery + Registration Ingestion** - Backend NATS consumer, MAC resolution, AP-CPE link state machine (completed 2026-03-19)
- [x] **Phase 14: Site Dashboard + Sector Views + Wireless UI** - Site detail page, sector-centric view, per-station wireless tables (completed 2026-03-19)
- [ ] **Phase 15: Signal Trending + Site Alerting** - Signal history charts, degradation detection, site/sector alert rules

## Phase Details

### Phase 11: Site Data Model + Foundation
**Goal**: Operators can organize devices by physical site and see a site list with aggregate health — without disrupting the existing flat-list workflow
**Depends on**: Nothing (first phase of v9.7; existing v9.6 foundation)
**Requirements**: SITE-01, SITE-02, SITE-03, SITE-04, SITE-05, SITE-06, DASH-01
**Success Criteria** (what must be TRUE):
  1. Operator can create, edit, and delete a site with name, coordinates, address, elevation, and notes
  2. Operator can assign one or many devices to a site, and remove a device back to "unassigned"
  3. Site list page shows all tenant sites with device count, online percentage, and alert count
  4. Devices without a site assignment work identically in all existing views (device list, device detail, remote access, config backup)
  5. Sites are tenant-scoped — one tenant cannot see or modify another tenant's sites
**Plans:** 3/3 plans complete

Plans:
- [ ] 11-01-PLAN.md — Backend data model, migration, service, and REST API for sites
- [ ] 11-02-PLAN.md — Frontend site list page, CRUD dialogs, and navigation integration
- [ ] 11-03-PLAN.md — Device-to-site assignment UI and fleet table site column

### Phase 12: Per-Client Wireless Collection
**Goal**: The Go poller collects per-client registration table data and per-interface RF stats from all wireless devices, publishing to a dedicated NATS stream
**Depends on**: Phase 11 (schema for wireless_registrations hypertable created in Phase 11 migrations)
**Requirements**: WRCL-01, WRCL-02, WRCL-03, WRCL-04, WRCL-05, WRCL-06
**Success Criteria** (what must be TRUE):
  1. Poller collects per-client registration data (MAC, signal, CCQ, TX/RX rates, distance, uptime) from APs on a 5-minute cadence
  2. Poller collects per-interface RF stats (noise floor, channel width, TX power, client count) via the monitor command
  3. Per-client data publishes to a dedicated WIRELESS_REGISTRATIONS NATS stream (not DEVICE_EVENTS)
  4. Per-client data stores in a dedicated hypertable with 30-day retention
  5. Collection works correctly on both RouterOS v6 (wireless package) and v7 (wifi package) with graceful handling of missing fields
**Plans:** 2/2 plans complete

Plans:
- [ ] 12-01-PLAN.md — Go poller per-client registration collector, signal parser, RF monitor, NATS stream and publisher
- [ ] 12-02-PLAN.md — Backend wireless_registrations hypertable migration and NATS subscriber

### Phase 13: Link Discovery + Registration Ingestion
**Goal**: Backend automatically discovers AP-CPE relationships from wireless registration data and maintains link state with temporal stability
**Depends on**: Phase 12 (per-client data flowing through NATS)
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04
**Success Criteria** (what must be TRUE):
  1. Backend matches registration table MAC addresses against known device interface MACs to discover AP-CPE links
  2. Link state follows a temporal state machine (discovered, active, degraded, down, stale) with consecutive-miss threshold to prevent false flapping
  3. Discovered links are stored in a materialized wireless_links table for fast dashboard queries
  4. Wireless clients whose MACs do not match any managed device appear as "unknown clients" with their signal and rate data preserved
**Plans:** 3/3 plans complete

Plans:
- [ ] 13-01-PLAN.md — Go poller interface collector (/interface/print) and DEVICE_EVENTS publisher
- [ ] 13-02-PLAN.md — Backend device_interfaces and wireless_links table migrations with ORM models
- [ ] 13-03-PLAN.md — Link discovery subscriber, interface subscriber, link REST API, and app wiring

### Phase 14: Site Dashboard + Sector Views + Wireless UI
**Goal**: Operators can drill into any site to see device health, sector-organized AP/CPE views, and per-station wireless details on device pages
**Depends on**: Phase 13 (wireless_links populated, registration data queryable)
**Requirements**: DASH-02, DASH-03, DASH-04, SECT-01, SECT-02, SECT-03, WRUI-01, WRUI-02, WRUI-03
**Success Criteria** (what must be TRUE):
  1. Site dashboard shows a device health grid with status, CPU, memory, and uptime for all devices at the site
  2. Sector-centric view within the site dashboard groups APs by sector, showing connected CPEs, aggregate bandwidth, and signal distribution
  3. Site dashboard displays wireless link topology showing which CPEs connect to which APs with signal quality indicators
  4. Device detail page shows a per-station wireless table (connected clients with MAC, signal, CCQ, TX/RX rates, distance, uptime) and per-interface RF stats
  5. Operator can define sectors within a site, assign APs to sectors, and view aggregate stats per sector
**Plans:** 3/3 plans complete

Plans:
- [ ] 14-01-PLAN.md — Sector backend (migration, model, service, router), site_id device filter, wireless data APIs, frontend API clients
- [ ] 14-02-PLAN.md — Device detail wireless station table, RF stats card, standalone wireless links page
- [ ] 14-03-PLAN.md — Site dashboard with tabbed views (Health Grid, Sectors, Links)

### Phase 15: Signal Trending + Site Alerting
**Goal**: Operators can track signal quality over time and receive alerts when site or sector conditions degrade
**Depends on**: Phase 14 (dashboards exist to surface trends and alerts); requires accumulated wireless data from Phases 12-13
**Requirements**: TRND-01, TRND-02, ALRT-01, ALRT-02
**Success Criteria** (what must be TRUE):
  1. Operator can view per-station signal history charts showing signal strength over time
  2. System detects and surfaces signal degradation trends (e.g., "signal dropped 8dB over 2 weeks")
  3. Operator can create site-scoped alert rules (e.g., "alert when >20% of devices at this site go offline")
  4. Operator can create sector-scoped alert rules (e.g., "alert when sector average signal drops below -75dBm")
**Plans:** 2/3 plans executed

Plans:
- [ ] 15-01-PLAN.md — Backend data model, services, and REST API for site alert rules, alert events, and signal history
- [ ] 15-02-PLAN.md — Backend scheduled tasks (trend detection + alert evaluation) and frontend API clients
- [ ] 15-03-PLAN.md — Frontend signal history charts, alert rules UI, alert events table, and notification bell

## Coverage

| Category | Requirements | Phase | Count |
|----------|-------------|-------|-------|
| Sites | SITE-01, SITE-02, SITE-03, SITE-04, SITE-05, SITE-06 | 11 | 3/3 | Complete    | 2026-03-19 | DASH-01 | 11 | 1 |
| Site Dashboard | DASH-02, DASH-03, DASH-04 | 14 | 3/3 | Complete    | 2026-03-19 | SECT-01, SECT-02, SECT-03 | 14 | 3 |
| Wireless Collection | WRCL-01, WRCL-02, WRCL-03, WRCL-04, WRCL-05, WRCL-06 | 12 | 2/2 | Complete    | 2026-03-19 | LINK-01, LINK-02, LINK-03, LINK-04 | 13 | 3/3 | Complete    | 2026-03-19 | WRUI-01, WRUI-02, WRUI-03 | 14 | 3 |
| Signal Trending | TRND-01, TRND-02 | 15 | 2/3 | In Progress|  | ALRT-01, ALRT-02 | 15 | 2 |
| **Total** | | | **30** |

## Progress

**Execution Order:**
Phases execute in numeric order: 11 -> 11.x -> 12 -> 12.x -> 13 -> 13.x -> 14 -> 14.x -> 15

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 11. Site Data Model + Foundation | 0/3 | Planning complete | - |
| 12. Per-Client Wireless Collection | 0/2 | Planning complete | - |
| 13. Link Discovery + Registration Ingestion | 0/3 | Planning complete | - |
| 14. Site Dashboard + Sector Views + Wireless UI | 0/3 | Planning complete | - |
| 15. Signal Trending + Site Alerting | 0/3 | Planning complete | - |

---
*Roadmap created: 2026-03-18*
*Last updated: 2026-03-19*
