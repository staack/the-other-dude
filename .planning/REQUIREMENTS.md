# Requirements: TOD v9.7 — Tower & Site Management

**Defined:** 2026-03-18
**Core Value:** Operators can organize their MikroTik fleet by physical site, see tower-level health with sector/CPE views, and collect full wireless radio statistics — without disrupting the flat-list MSP workflow.

## v9.7 Requirements

### Sites

- [x] **SITE-01**: Operator can create a site with name, coordinates (lat/lng), address, elevation, and notes
- [x] **SITE-02**: Operator can edit and delete sites
- [x] **SITE-03**: Operator can assign devices to a site (single and bulk assignment)
- [x] **SITE-04**: Operator can remove a device from a site (device returns to "unassigned")
- [x] **SITE-05**: Devices without a site assignment continue to work normally in all existing views
- [x] **SITE-06**: Sites are tenant-scoped — each tenant manages their own sites independently

### Site Dashboard

- [x] **DASH-01**: Operator can view a site list page showing all sites with health rollup (device count, online %, alert count)
- [ ] **DASH-02**: Operator can click into a site to see a device health grid (status, CPU, memory, uptime for all devices at that site)
- [ ] **DASH-03**: Operator can switch to a sector-centric view within a site dashboard showing APs grouped by sector with connected CPEs, aggregate bandwidth, and signal distribution
- [ ] **DASH-04**: Site dashboard shows wireless link topology (which CPEs connect to which APs) with signal quality indicators

### Sectors

- [ ] **SECT-01**: Operator can define sectors within a site (name, optional azimuth/bearing)
- [ ] **SECT-02**: Operator can assign APs to sectors
- [ ] **SECT-03**: Sector view shows aggregate client count, bandwidth, and signal statistics per sector

### Wireless Collection

- [x] **WRCL-01**: Poller collects per-client registration table data from APs (MAC, signal, CCQ, TX/RX rates, distance, uptime) on a 5-minute cadence
- [x] **WRCL-02**: Poller collects per-interface RF stats (noise floor, channel width, TX power, registered client count) via monitor command
- [x] **WRCL-03**: Per-client wireless data publishes to a dedicated NATS stream (separate from DEVICE_EVENTS) to prevent stream saturation
- [x] **WRCL-04**: Per-client wireless data stores in a dedicated hypertable with 30-day retention (separate from existing wireless_metrics)
- [x] **WRCL-05**: Poller handles RouterOS v6/v7 field differences gracefully (CCQ absent in v7 wifi package)
- [x] **WRCL-06**: Signal strength parsing handles RouterOS format variations (e.g., `-67@5GHz` suffix)

### Link Discovery

- [ ] **LINK-01**: Backend auto-discovers AP-CPE relationships by matching registration table MAC addresses against known device interface MACs
- [ ] **LINK-02**: Link state uses a temporal state machine (discovered -> active -> degraded -> down -> stale) with consecutive-miss threshold to prevent false flapping
- [ ] **LINK-03**: Wireless links are stored in a materialized table for fast dashboard queries
- [ ] **LINK-04**: Unmanaged wireless clients (MACs not matching any TOD device) are displayed as "unknown clients" with signal/rate data

### Wireless UI

- [ ] **WRUI-01**: Device detail page shows a per-station wireless table (connected clients with MAC, signal, CCQ, TX/RX rates, distance, uptime)
- [ ] **WRUI-02**: Device detail page shows per-interface RF stats (noise floor, channel width, TX power)
- [ ] **WRUI-03**: Wireless links page shows all discovered AP-CPE relationships with signal quality and link state

### Signal Trending

- [ ] **TRND-01**: Operator can view per-station signal history charts showing signal strength over time
- [ ] **TRND-02**: System detects signal degradation trends (e.g., "signal dropped 8dB over 2 weeks")

### Site Alerting

- [ ] **ALRT-01**: Operator can create site-scoped alert rules (e.g., "alert when >20% of devices at this site go offline")
- [ ] **ALRT-02**: Operator can create sector-scoped alert rules (e.g., "alert when sector average signal drops below -75dBm")

## Future Requirements

### Map View

- **MAP-01**: Operator can view sites on a geographic map with health-status-colored markers
- **MAP-02**: Operator can click a map marker to drill into the site dashboard

### Advanced Wireless

- **ADV-01**: Cross-reference wireless anomalies with config change timeline
- **ADV-02**: CAPsMAN read-only discovery (discover CAPsMAN-managed APs and display status)
- **ADV-03**: On-demand spectral scan trigger with result display

### Config Restore (deferred from v9.6)

- **REST-01**: User can restore a config snapshot to a router via SSH
- **REST-02**: Restore confirmation dialog with diff preview

## Out of Scope

| Feature | Reason |
|---------|--------|
| Map/geo visualization | Deferred to future milestone — adds tile provider complexity, dashboards deliver value faster |
| Config restore via UI | Deferred from v9.6 — still out of scope |
| Subscriber/customer management | BSS territory (Sonar/Powercode) — TOD is NMS, not billing |
| RF planning / link budget calculator | Dedicated RF planning tools exist — TOD monitors deployed infrastructure |
| Automated radio parameter changes | Dangerous in production WISPs — TOD provides visibility, not automation |
| Real-time spectrum analyzer | Requires continuous high-frequency polling — offer on-demand scan instead (future) |
| CAPsMAN configuration management | Complex and version-sensitive — read-only discovery deferred |
| Spectral scan during automated polling | Takes interface offline (destructive) — never auto-poll |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SITE-01 | Phase 11 | Complete |
| SITE-02 | Phase 11 | Complete |
| SITE-03 | Phase 11 | Complete |
| SITE-04 | Phase 11 | Complete |
| SITE-05 | Phase 11 | Complete |
| SITE-06 | Phase 11 | Complete |
| DASH-01 | Phase 11 | Complete |
| DASH-02 | Phase 14 | Pending |
| DASH-03 | Phase 14 | Pending |
| DASH-04 | Phase 14 | Pending |
| SECT-01 | Phase 14 | Pending |
| SECT-02 | Phase 14 | Pending |
| SECT-03 | Phase 14 | Pending |
| WRCL-01 | Phase 12 | Complete |
| WRCL-02 | Phase 12 | Complete |
| WRCL-03 | Phase 12 | Complete |
| WRCL-04 | Phase 12 | Complete |
| WRCL-05 | Phase 12 | Complete |
| WRCL-06 | Phase 12 | Complete |
| LINK-01 | Phase 13 | Pending |
| LINK-02 | Phase 13 | Pending |
| LINK-03 | Phase 13 | Pending |
| LINK-04 | Phase 13 | Pending |
| WRUI-01 | Phase 14 | Pending |
| WRUI-02 | Phase 14 | Pending |
| WRUI-03 | Phase 14 | Pending |
| TRND-01 | Phase 15 | Pending |
| TRND-02 | Phase 15 | Pending |
| ALRT-01 | Phase 15 | Pending |
| ALRT-02 | Phase 15 | Pending |

**Coverage:**
- v9.7 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation*
