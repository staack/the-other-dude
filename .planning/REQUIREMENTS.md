# Requirements: TOD v9.8 — SNMP Device Integration

**Defined:** 2026-03-21
**Core Value:** Operators can monitor their entire network fleet — MikroTik and SNMP devices side by side — from a single pane of glass
**Design Spec:** `docs/superpowers/specs/2026-03-21-v98-snmp-integration-design.md`

## v9.8 Requirements

### Foundation

- [x] **FOUND-01**: Device model supports a device_type discriminator (routeros vs snmp) with backward-compatible defaults
- [x] **FOUND-02**: Database schema includes snmp_profiles table with system-shipped profiles and tenant-custom profiles
- [x] **FOUND-03**: Database schema includes unified credential_profiles table supporting routeros, snmp_v2c, and snmp_v3 credential types
- [x] **FOUND-04**: Database schema includes snmp_metrics hypertable for custom OID time-series data with 90-day retention
- [x] **FOUND-05**: Poller Collector interface abstracts device-type-specific collection (RouterOS and SNMP implementations)
- [x] **FOUND-06**: Existing PollDevice logic refactored into RouterOSCollector without behavior changes

### Credential Management

- [x] **CRED-01**: Operator can create a credential profile (RouterOS or SNMP) with encrypted storage via OpenBao Transit
- [x] **CRED-02**: Operator can assign a credential profile to one or many devices instead of per-device credentials
- [x] **CRED-03**: Updating a credential profile propagates new credentials to all linked devices on next poll cycle
- [x] **CRED-04**: Poller resolves credentials via fallback: per-device credentials first, then credential profile
- [x] **CRED-05**: CredentialCache refactored to GetRawCredentials with type-specific parsers (RouterOS, SNMPv2c, SNMPv3)

### SNMP Polling

- [x] **POLL-01**: Poller can poll SNMP devices using gosnmp with SNMPv1, v2c, and v3 support
- [x] **POLL-02**: SNMP collection is profile-driven — device profile defines which OIDs to collect per poll group
- [x] **POLL-03**: Standard SNMP metrics (ifXTable, hrStorageTable, hrProcessorLoad) map to existing hypertables (interface_metrics, health_metrics)
- [x] **POLL-04**: Custom OID data publishes as SNMPMetricsEvent and inserts into snmp_metrics hypertable
- [x] **POLL-05**: Counter32/Counter64 delta computation with Redis cache, including wraparound detection and sanity threshold
- [x] **POLL-06**: Profile cache refreshes from database periodically without per-device DB queries
- [x] **POLL-07**: SNMP devices use same scheduler, circuit breaker, Redis locks, and NATS pipeline as RouterOS devices

### Device Profiles

- [x] **PROF-01**: TOD ships 6 system default profiles (generic-snmp, network-switch, network-router, wireless-ap, ups-device, mikrotik-snmp)
- [x] **PROF-02**: Auto-detection probes sysObjectID via NATS request-reply and suggests matching profile
- [x] **PROF-03**: Operator can create custom SNMP profiles with arbitrary OID collections grouped by poll group
- [x] **PROF-04**: Operator can upload vendor MIB files and browse parsed OID tree to select collection targets
- [x] **PROF-05**: Operator can test a profile against a live device before saving

### Device Management

- [x] **MGMT-01**: Operator can add a single SNMP device with IP, SNMP version, credential (profile or manual), and device profile
- [x] **MGMT-02**: Operator can bulk-add RouterOS devices using a credential profile + IP list (one per line, CIDR, or range)
- [x] **MGMT-03**: Operator can bulk-add SNMP devices using a credential profile + IP list with auto-detected profiles
- [x] **MGMT-04**: Subnet scan discovers both RouterOS and SNMP devices with protocol-specific credential profiles
- [x] **MGMT-05**: Bulk add returns per-device results (success/failure with reason) and supports partial success

### Fleet UI

- [x] **UI-01**: Fleet table shows SNMP devices alongside MikroTik devices with type icon, status, CPU, memory, uptime
- [x] **UI-02**: Fleet table supports filtering by device type (All / RouterOS / SNMP)
- [x] **UI-03**: Device detail page conditionally renders sections based on device_type (no RouterOS-only sections for SNMP devices)
- [x] **UI-04**: SNMP device detail shows system info, interface metrics, health metrics, and custom OID charts
- [x] **UI-05**: Add Device dialog has tabs for RouterOS, SNMP, and VPN with credential profile selectors
- [x] **UI-06**: Credential profile management page lists, creates, edits, deletes profiles for both types
- [x] **UI-07**: SNMP profile editor with OID tree browser, MIB upload, poll group configuration

### Metrics & Data

- [x] **DATA-01**: SNMP interface metrics (rx_bytes, tx_bytes, rx_bps, tx_bps) stored in existing interface_metrics hypertable
- [x] **DATA-02**: SNMP health metrics (CPU, memory, disk) stored in existing health_metrics hypertable
- [x] **DATA-03**: Custom SNMP metrics stored in snmp_metrics hypertable with metric_name, metric_group, oid, and value
- [x] **DATA-04**: SNMP metrics API returns time-bucketed data in same format as existing metrics endpoints
- [x] **DATA-05**: Frontend charts for interface traffic and health work identically for SNMP and RouterOS devices

### Backward Compatibility

- [x] **COMPAT-01**: All existing RouterOS device functionality works unchanged after v9.8 migration
- [x] **COMPAT-02**: Existing API responses maintain shape (new fields are additive only)
- [x] **COMPAT-03**: Existing NATS event types and subjects are unchanged
- [x] **COMPAT-04**: 500+ mixed MikroTik/SNMP devices can be polled without performance degradation

## Future Requirements (v9.9+)

### SNMP Traps

- **TRAP-01**: TOD receives and processes SNMP traps/informs
- **TRAP-02**: Trap events surface in the UI alongside polled metrics
- **TRAP-03**: Trap deduplication and rate limiting per device

### Extended Monitoring

- **EXT-01**: SNMP SET operations for device configuration
- **EXT-02**: sFlow/NetFlow/IPFIX collection
- **EXT-03**: Multi-protocol devices (RouterOS API + SNMP on same device)

### Extensibility

- **EXTENS-01**: External check executor (run scripts, parse output)
- **EXTENS-02**: Nagios plugin output format support
- **EXTENS-03**: Telegraf input plugin execution

## Out of Scope

| Feature | Reason |
|---------|--------|
| SNMP SET operations | Read-only monitoring for v9.8; write operations are vendor-specific |
| SNMP trap/inform reception | Requires listening server, firewall changes — deferred to v9.9 |
| SNMP device config backup | No standard SNMP mechanism exists |
| Nagios plugin execution | Trivially simple but not core to SNMP milestone — v10 extensibility |
| sFlow/NetFlow/IPFIX | Separate monitoring domain, v10+ |
| Multi-protocol devices | One device_type per device for v9.8 simplicity |
| SNMP device firmware management | No standard mechanism, vendor-specific |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 16 | Complete |
| FOUND-02 | Phase 16 | Complete |
| FOUND-03 | Phase 16 | Complete |
| FOUND-04 | Phase 16 | Complete |
| FOUND-05 | Phase 16 | Complete |
| FOUND-06 | Phase 16 | Complete |
| CRED-01 | Phase 17 | Complete |
| CRED-02 | Phase 17 | Complete |
| CRED-03 | Phase 17 | Complete |
| CRED-04 | Phase 16 | Complete |
| CRED-05 | Phase 16 | Complete |
| POLL-01 | Phase 18 | Complete |
| POLL-02 | Phase 18 | Complete |
| POLL-03 | Phase 18 | Complete |
| POLL-04 | Phase 18 | Complete |
| POLL-05 | Phase 18 | Complete |
| POLL-06 | Phase 18 | Complete |
| POLL-07 | Phase 18 | Complete |
| PROF-01 | Phase 18 | Complete |
| PROF-02 | Phase 18 | Complete |
| PROF-03 | Phase 20 | Complete |
| PROF-04 | Phase 20 | Complete |
| PROF-05 | Phase 20 | Complete |
| MGMT-01 | Phase 19 | Complete |
| MGMT-02 | Phase 19 | Complete |
| MGMT-03 | Phase 19 | Complete |
| MGMT-04 | Phase 19 | Complete |
| MGMT-05 | Phase 19 | Complete |
| UI-01 | Phase 19 | Complete |
| UI-02 | Phase 19 | Complete |
| UI-03 | Phase 19 | Complete |
| UI-04 | Phase 19 | Complete |
| UI-05 | Phase 19 | Complete |
| UI-06 | Phase 19 | Complete |
| UI-07 | Phase 20 | Complete |
| DATA-01 | Phase 18 | Complete |
| DATA-02 | Phase 18 | Complete |
| DATA-03 | Phase 18 | Complete |
| DATA-04 | Phase 17 | Complete |
| DATA-05 | Phase 19 | Complete |
| COMPAT-01 | Phase 16 | Complete |
| COMPAT-02 | Phase 16 | Complete |
| COMPAT-03 | Phase 16 | Complete |
| COMPAT-04 | Phase 18 | Complete |

**Coverage:**
- v9.8 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation*
