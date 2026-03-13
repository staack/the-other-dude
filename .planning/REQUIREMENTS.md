# Requirements: RouterOS Config Backup & Change Tracking

**Defined:** 2026-03-12
**Core Value:** Operators can see exactly what changed on a router and when, with reliable config snapshots for download

## v1 Requirements

### Collection

- [x] **COLL-01**: Poller collects RouterOS config via SSH `/export show-sensitive` on a configurable interval (default 6h)
- [x] **COLL-02**: Poller normalizes config output (trim whitespace, normalize line endings, remove timestamp headers)
- [ ] **COLL-03**: Poller sends config snapshot to API via NATS subject `config.snapshot.create`
- [ ] **COLL-04**: Manual backup trigger via POST `/api/tenants/{tenant_id}/devices/{device_id}/backup`
- [ ] **COLL-05**: Unreachable routers log warning and retry next interval
- [x] **COLL-06**: Collection interval configurable via `CONFIG_BACKUP_INTERVAL` environment variable

### Storage

- [x] **STOR-01**: API stores config snapshots in `router_config_snapshots` table with SHA256 hash
- [ ] **STOR-02**: Duplicate snapshots (same hash as previous) are skipped, no diff generated
- [ ] **STOR-03**: Snapshots retained for 90 days (configurable via `CONFIG_RETENTION_DAYS`)
- [ ] **STOR-04**: Older snapshots automatically deleted by retention cleanup
- [x] **STOR-05**: Snapshots encrypted at rest, accessible only through RBAC

### Diff & Parsing

- [ ] **DIFF-01**: Unified diff generated when new snapshot differs from previous
- [ ] **DIFF-02**: Diffs stored in `router_config_diffs` table linking snapshot pairs
- [ ] **DIFF-03**: Structured change parser extracts component, summary, and raw line as JSON
- [ ] **DIFF-04**: Parsed changes stored in `router_config_changes` table

### API

- [ ] **API-01**: GET `/api/tenants/{tid}/devices/{did}/config-history` returns change timeline
- [ ] **API-02**: GET `/api/tenants/{tid}/devices/{did}/config/{snapshot_id}` returns full snapshot
- [ ] **API-03**: GET `/api/tenants/{tid}/devices/{did}/config/{snapshot_id}/diff` returns unified diff
- [ ] **API-04**: RBAC enforced: operator+ can trigger backups, viewers can read history

### Frontend

- [ ] **UI-01**: Device page shows Configuration History section below Remote Access
- [ ] **UI-02**: Timeline displays change entries with component, summary, and timestamp
- [ ] **UI-03**: Diff viewer shows unified diff with add/remove highlighting
- [ ] **UI-04**: User can download snapshot as `router-{device_name}-{timestamp}.rsc`

### Observability

- [ ] **OBS-01**: Audit events logged: `config_snapshot_created`, `config_snapshot_skipped_duplicate`
- [ ] **OBS-02**: Audit events logged: `config_diff_generated`, `config_backup_manual_trigger`

## v2 Requirements

### Restore

- **REST-01**: User can restore a config snapshot to a router via SSH
- **REST-02**: Restore confirmation dialog with diff preview

## Out of Scope

| Feature | Reason |
|---------|--------|
| Config restore | Explicitly deferred per v9.6 spec |
| Non-RouterOS device backup | Spec scopes to RouterOS only initially |
| Real-time change detection | Polling-based by design, not event-driven |
| Config comparison between arbitrary snapshots | Only consecutive snapshot diffs in v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| COLL-01 | Phase 2: Poller Config Collection | Complete |
| COLL-02 | Phase 2: Poller Config Collection | Complete |
| COLL-03 | Phase 2: Poller Config Collection | Pending |
| COLL-04 | Phase 4: Manual Backup Trigger | Pending |
| COLL-05 | Phase 2: Poller Config Collection | Pending |
| COLL-06 | Phase 2: Poller Config Collection | Complete |
| STOR-01 | Phase 1: Database Schema | Complete |
| STOR-02 | Phase 3: Snapshot Ingestion | Pending |
| STOR-03 | Phase 9: Retention & Cleanup | Pending |
| STOR-04 | Phase 9: Retention & Cleanup | Pending |
| STOR-05 | Phase 1: Database Schema | Complete |
| DIFF-01 | Phase 5: Diff Engine | Pending |
| DIFF-02 | Phase 5: Diff Engine | Pending |
| DIFF-03 | Phase 5: Diff Engine | Pending |
| DIFF-04 | Phase 5: Diff Engine | Pending |
| API-01 | Phase 6: History API | Pending |
| API-02 | Phase 6: History API | Pending |
| API-03 | Phase 6: History API | Pending |
| API-04 | Phase 6: History API | Pending |
| UI-01 | Phase 7: Config History UI | Pending |
| UI-02 | Phase 7: Config History UI | Pending |
| UI-03 | Phase 8: Diff Viewer & Download | Pending |
| UI-04 | Phase 8: Diff Viewer & Download | Pending |
| OBS-01 | Phase 10: Audit & Observability | Pending |
| OBS-02 | Phase 10: Audit & Observability | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after roadmap creation*
