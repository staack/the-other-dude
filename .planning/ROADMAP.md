# Roadmap: RouterOS Config Backup & Change Tracking (v9.6)

## Overview

This roadmap delivers automated RouterOS configuration backup and change tracking as a new feature within the existing TOD platform. Work flows from database schema through the Go poller (collection), Python backend (storage, diffing, API), and React frontend (timeline, diff viewer, download). Each phase delivers a verifiable layer that the next phase builds on, culminating in a complete config history workflow with retention management and audit logging.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

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

## Phase Details

### Phase 1: Database Schema
**Goal**: Database tables exist to store config snapshots, diffs, and parsed changes with proper multi-tenant isolation and encryption
**Depends on**: Nothing (first phase)
**Requirements**: STOR-01, STOR-05
**Success Criteria** (what must be TRUE):
  1. Alembic migration creates `router_config_snapshots`, `router_config_diffs`, and `router_config_changes` tables
  2. All tables include `tenant_id` with RLS policies enforcing tenant isolation
  3. Snapshot config_text column is encrypted at rest (field-level encryption via existing credential pattern)
  4. SQLAlchemy models exist and can be imported by services
**Plans**: 1 plan

Plans:
- [ ] 01-01-PLAN.md — Alembic migration and SQLAlchemy models for config backup tables

### Phase 2: Poller Config Collection
**Goal**: Go poller periodically connects to RouterOS devices via SSH, exports config, normalizes output, and publishes to NATS
**Depends on**: Phase 1
**Requirements**: COLL-01, COLL-02, COLL-03, COLL-05, COLL-06
**Success Criteria** (what must be TRUE):
  1. Poller runs `/export show-sensitive` via SSH on each RouterOS device at a configurable interval (default 6h)
  2. Config output is normalized (timestamps stripped, whitespace trimmed, line endings unified) before publishing
  3. Poller publishes config snapshot payload to NATS subject `config.snapshot.create` with device_id and tenant_id
  4. Unreachable devices log a warning and are retried on the next interval without blocking other devices
  5. Interval is configurable via `CONFIG_BACKUP_INTERVAL` environment variable
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — SSH executor, config normalizer, env vars, NATS event type, device model extensions, Alembic migration
- [ ] 02-02-PLAN.md — Backup scheduler with per-device goroutines, concurrency control, retry logic, and main.go wiring

### Phase 3: Snapshot Ingestion
**Goal**: Backend receives config snapshots from NATS, encrypts via Transit, deduplicates by SHA256, and stores new snapshots
**Depends on**: Phase 1, Phase 2
**Requirements**: STOR-02
**Success Criteria** (what must be TRUE):
  1. Backend NATS subscriber consumes `config.snapshot.create` messages and persists snapshots to `router_config_snapshots`
  2. When a snapshot has the same SHA256 hash as the device's most recent snapshot, it is skipped (no new row, no diff)
  3. Each stored snapshot includes device_id, tenant_id, config_text (encrypted), sha256_hash, and collected_at timestamp
**Plans**: 1 plan

Plans:
- [ ] 03-01-PLAN.md — NATS subscriber for config snapshot ingestion with dedup, encryption, and main.py wiring

### Phase 4: Manual Backup Trigger
**Goal**: Operators can trigger an immediate config backup for a specific device through the API
**Depends on**: Phase 2, Phase 3
**Requirements**: COLL-04
**Success Criteria** (what must be TRUE):
  1. POST `/api/tenants/{tenant_id}/devices/{device_id}/backup` triggers an immediate config collection for the specified device
  2. The triggered backup flows through the same collection and ingestion pipeline as scheduled backups
  3. Endpoint requires operator role or higher (viewers cannot trigger)
**Plans**: 1 plan

Plans:
- [ ] 04-01-PLAN.md — Go BackupResponder (NATS request-reply) + Python API trigger endpoint

### Phase 5: Diff Engine
**Goal**: When a new (non-duplicate) snapshot is stored, the system generates a unified diff against the previous snapshot and parses structured changes
**Depends on**: Phase 3
**Requirements**: DIFF-01, DIFF-02, DIFF-03, DIFF-04
**Success Criteria** (what must be TRUE):
  1. Unified diff is generated between consecutive snapshots when config content differs
  2. Diff is stored in `router_config_diffs` linking the two snapshot IDs
  3. Structured change parser extracts component name, human-readable summary, and raw diff line for each change
  4. Parsed changes are stored in `router_config_changes` as JSON-structured records
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Unified diff generation service with Transit decrypt and subscriber integration
- [ ] 05-02-PLAN.md — Structured change parser extracting components and summaries from diffs

### Phase 6: History API
**Goal**: Frontend can query config change timeline, retrieve full snapshots, and view diffs through RBAC-protected endpoints
**Depends on**: Phase 5
**Requirements**: API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. GET `/api/tenants/{tid}/devices/{did}/config-history` returns paginated change timeline with component, summary, and timestamp
  2. GET `/api/tenants/{tid}/devices/{did}/config/{snapshot_id}` returns full snapshot content
  3. GET `/api/tenants/{tid}/devices/{did}/config/{snapshot_id}/diff` returns unified diff text
  4. All endpoints enforce RBAC: viewer+ can read history, operator+ required for backup trigger
  5. Endpoints return proper 404 for nonexistent snapshots and 403 for unauthorized access
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md — Config history timeline endpoint with service, router, and tests
- [ ] 06-02-PLAN.md — Snapshot view and diff retrieval endpoints with Transit decrypt and RBAC

### Phase 7: Config History UI
**Goal**: Device detail page displays a Configuration History section showing a timeline of config changes
**Depends on**: Phase 6
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Device detail page shows a "Configuration History" section below the Remote Access section
  2. Timeline displays change entries with component badge, summary text, and relative timestamp
  3. Timeline loads via TanStack Query and shows loading/empty states appropriately
**Plans**: 1 plan

Plans:
- [ ] 07-01-PLAN.md — API client, ConfigHistorySection component, and device detail page wiring

### Phase 8: Diff Viewer & Download
**Goal**: Users can view unified diffs with syntax highlighting and download any snapshot as a .rsc file
**Depends on**: Phase 7
**Requirements**: UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. Clicking a timeline entry opens a diff viewer showing unified diff with add (green) / remove (red) line highlighting
  2. User can download any snapshot as `router-{device_name}-{timestamp}.rsc` file
  3. Diff viewer handles large configs without performance degradation
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md — Unified diff viewer component with syntax highlighting and clickable timeline entries
- [ ] 08-02-PLAN.md — Snapshot download as .rsc file with download button on timeline entries

### Phase 9: Retention & Cleanup
**Goal**: Snapshots older than the retention period are automatically cleaned up, keeping storage bounded
**Depends on**: Phase 3
**Requirements**: STOR-03, STOR-04
**Success Criteria** (what must be TRUE):
  1. Snapshots older than 90 days (default) are automatically deleted along with their associated diffs and changes
  2. Retention period is configurable via `CONFIG_RETENTION_DAYS` environment variable
  3. Cleanup runs on a scheduled interval without blocking normal operations
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md — Retention cleanup service with APScheduler, configurable retention period, and cascading deletion

### Phase 10: Audit & Observability
**Goal**: All config backup operations are logged as audit events for compliance and troubleshooting
**Depends on**: Phase 3, Phase 4, Phase 5
**Requirements**: OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. `config_snapshot_created` audit event logged when a new snapshot is stored
  2. `config_snapshot_skipped_duplicate` audit event logged when a duplicate snapshot is detected
  3. `config_diff_generated` audit event logged when a diff is created between snapshots
  4. `config_backup_manual_trigger` audit event logged when an operator triggers a manual backup
**Plans**: 1 plan

Plans:
- [ ] 10-01-PLAN.md — Audit event emission for all config backup operations

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Note: Phase 9 depends only on Phase 3 and Phase 10 depends on Phases 3/4/5, so Phases 9 and 10 can execute in parallel with Phases 6-8 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Database Schema | 1/1 | Complete    | 2026-03-13 |
| 2. Poller Config Collection | 2/2 | Complete    | 2026-03-13 |
| 3. Snapshot Ingestion | 0/1 | Not started | - |
| 4. Manual Backup Trigger | 1/1 | Complete   | 2026-03-13 |
| 5. Diff Engine | 2/2 | Complete   | 2026-03-13 |
| 6. History API | 2/2 | Complete   | 2026-03-13 |
| 7. Config History UI | 1/1 | Complete   | 2026-03-13 |
| 8. Diff Viewer & Download | 1/2 | In Progress|  |
| 9. Retention & Cleanup | 1/1 | Complete   | 2026-03-13 |
| 10. Audit & Observability | 1/1 | Complete   | 2026-03-13 |
