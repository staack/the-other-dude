# RouterOS Config Backup & Change Tracking (v9.6)

## What This Is

Automated RouterOS configuration backup and human-readable change tracking for TOD (The Other Dude). Periodically collects router configurations via SSH, stores versioned snapshots, generates diffs, and presents a change timeline in the device UI. Applies to RouterOS devices only.

## Core Value

Operators can see exactly what changed on a router and when, with reliable config snapshots available for download — visibility into network changes that would otherwise go unnoticed.

## Requirements

### Validated

<!-- Existing TOD capabilities inferred from codebase -->

- ✓ Multi-tenant device management — existing
- ✓ Poller-based device monitoring via SSH — existing
- ✓ NATS message bus for poller↔API communication — existing
- ✓ Credential management with OpenBao Transit encryption — existing
- ✓ FastAPI backend with RBAC (viewer/operator/admin/super_admin) — existing
- ✓ React frontend with device detail pages — existing
- ✓ Remote access (SSH/WinBox tunneling) — existing (v9.5)

### Active

- [ ] Periodic config collection via SSH `/export show-sensitive`
- [ ] Manual backup trigger via API
- [ ] Config snapshot storage with SHA256 deduplication
- [ ] Unified diff generation between consecutive snapshots
- [ ] Structured change parsing (component, summary, raw line)
- [ ] Config history timeline API endpoints
- [ ] Full snapshot view/download API
- [ ] Configuration History section in device UI
- [ ] Timeline with change summaries and diff viewer
- [ ] Snapshot download as `.rsc` file
- [ ] RBAC: operator+ can trigger backups, viewers can read history
- [ ] Audit logging for snapshot/diff/trigger events
- [ ] 90-day retention with automatic cleanup
- [ ] Config text normalization (whitespace, timestamps, line endings)

### Out of Scope

- Config restore via UI — deferred to future version per spec
- Non-RouterOS device backup — spec explicitly scopes to RouterOS only
- Real-time config change detection — polling-based, not event-driven

## Context

- Poller is Go, runs SSH sessions to RouterOS devices, publishes to NATS
- Backend is Python/FastAPI with SQLAlchemy + Alembic migrations on PostgreSQL
- Frontend is React with TanStack Query, component library in `frontend/src/components/`
- Existing credential flow: poller requests creds from cache, decrypted via OpenBao Transit
- NATS subjects follow `{domain}.{entity}.{action}` pattern
- Device detail page already has Metrics and Remote Access sections

## Constraints

- **Tech stack**: Must use existing Go poller, Python backend, React frontend — no new services
- **Security**: Snapshots contain sensitive credentials (`show-sensitive`), must be encrypted at rest and RBAC-gated
- **NATS**: Config snapshots flow through NATS subject `config.snapshot.create`
- **Database**: New tables via Alembic migrations on existing PostgreSQL

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SSH `/export show-sensitive` for collection | Captures full config including secrets needed for restore | — Pending |
| SHA256 hash deduplication | Avoid storing identical configs, skip unnecessary diffs | — Pending |
| Unified diff format | Standard, well-understood, renderable in UI | — Pending |
| 6-hour default interval | Balance between freshness and SSH overhead | — Pending |
| NATS for poller→API transport | Consistent with existing poller architecture | — Pending |

---
*Last updated: 2026-03-12 after initialization*
