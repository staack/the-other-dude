# API Reference

## Overview

TOD exposes a REST API built with FastAPI. Interactive documentation is available at:

- Swagger UI: `http://<host>:<port>/docs` (dev environment only)
- ReDoc: `http://<host>:<port>/redoc` (dev environment only)

Both Swagger and ReDoc are disabled in staging/production environments.

## Authentication

### SRP-6a Login

- `POST /api/auth/login` -- SRP-6a authentication (returns JWT access + refresh tokens)
- `POST /api/auth/refresh` -- Refresh an expired access token
- `POST /api/auth/logout` -- Invalidate the current session

All authenticated endpoints require one of:

- `Authorization: Bearer <token>` header
- httpOnly cookie (set automatically by the login flow)

Access tokens expire after 15 minutes. Refresh tokens are valid for 7 days.

### API Key Authentication

- Create API keys in Admin > API Keys
- Use header: `X-API-Key: mktp_<key>`
- Keys have operator-level RBAC permissions
- Prefix: `mktp_`, stored as SHA-256 hash

## Endpoint Groups

All API routes are mounted under the `/api` prefix.

| Group | Prefix | Description |
|-------|--------|-------------|
| Auth | `/api/auth/*` | Login, register, SRP exchange, password reset, token refresh |
| Tenants | `/api/tenants/*` | Tenant/organization CRUD |
| Users | `/api/users/*` | User management, RBAC role assignment |
| Devices | `/api/devices/*` | Device CRUD, scanning, status |
| Device Groups | `/api/device-groups/*` | Logical device grouping |
| Device Tags | `/api/device-tags/*` | Tag-based device labeling |
| Metrics | `/api/metrics/*` | TimescaleDB device metrics (CPU, memory, traffic, wireless) |
| Wireless Issues | `/api/fleet/wireless-issues`, `/api/tenants/{id}/fleet/wireless-issues` | APs with degraded signal, CCQ, or dropped clients |
| Sites | `/api/tenants/{id}/sites/*` | Site CRUD, device-to-site assignment |
| Sectors | `/api/tenants/{id}/sites/{sid}/sectors/*` | Sector CRUD, device sector assignment |
| Wireless Links | `/api/tenants/{id}/links`, `/api/tenants/{id}/devices/{did}/links` | Link listing, RF stats, registrations |
| Signal History | `/api/tenants/{id}/devices/{did}/signal-history` | Per-client signal strength trending |
| Site Alerts | `/api/tenants/{id}/sites/{sid}/alert-rules/*`, `/api/tenants/{id}/alert-events/*` | Site-scoped alert rules and events |
| Config Backups | `/api/tenants/{id}/devices/{did}/config/*` | Config backup timeline, restore, schedules |
| Config Editor | `/api/config-editor/*` | Live RouterOS config browsing and editing |
| Firmware | `/api/firmware/*` | RouterOS firmware version management and upgrades |
| Alerts | `/api/alerts/*` | Alert rule CRUD, alert history |
| Events | `/api/events/*` | Device event log |
| Device Logs | `/api/device-logs/*` | RouterOS syslog entries |
| Templates | `/api/templates/*` | Config templates for batch operations |
| Clients | `/api/clients/*` | Connected client (DHCP lease) data |
| Topology | `/api/topology/*` | Network topology map data |
| SSE | `/api/sse/*` | Server-Sent Events for real-time updates |
| Audit Logs | `/api/audit-logs/*` | Immutable audit trail |
| Reports | `/api/reports/*` | PDF report generation (Jinja2 + WeasyPrint) |
| API Keys | `/api/api-keys/*` | API key CRUD |
| Maintenance Windows | `/api/maintenance-windows/*` | Scheduled maintenance window management |
| Remote Access | `/api/tenants/{id}/devices/{did}/*-session` | SSH terminal and WinBox tunnel sessions |
| WinBox Remote | `/api/tenants/{id}/devices/{did}/winbox-remote-sessions/*` | Browser-based WinBox sessions (Xpra) |
| VPN | `/api/vpn/*` | WireGuard VPN tunnel management |
| Certificates | `/api/certificates/*` | Internal CA and device certificate management |
| Transparency | `/api/transparency/*` | KMS access event dashboard |

## Health Checks

| Endpoint | Type | Description |
|----------|------|-------------|
| `GET /health` | Liveness | Always returns 200 if the API process is alive. Response includes `version`. |
| `GET /health/ready` | Readiness | Returns 200 only when PostgreSQL, Redis, and NATS are all healthy. Returns 503 otherwise. |
| `GET /api/health` | Liveness | Backward-compatible alias under `/api` prefix. |

## Rate Limiting

- Auth endpoints: 5 requests/minute per IP
- General endpoints: no global rate limit (per-route limits may apply)

Rate limit violations return HTTP 429 with a JSON error body.

## Error Format

All error responses use a standard JSON format:

```json
{
  "detail": "Human-readable error message"
}
```

HTTP status codes follow REST conventions:

| Code | Meaning |
|------|---------|
| 400 | Bad request / validation error |
| 401 | Unauthorized (missing or expired token) |
| 403 | Forbidden (insufficient RBAC permissions) |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 422 | Unprocessable entity (Pydantic validation) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 503 | Service unavailable (readiness check failed) |

## RBAC Roles

Endpoints enforce role-based access control. The four roles in descending privilege order:

| Role | Scope | Description |
|------|-------|-------------|
| `super_admin` | Global (no tenant) | Full platform access, tenant management |
| `admin` | Tenant | Full access within their tenant |
| `operator` | Tenant | Device operations, config changes |
| `viewer` | Tenant | Read-only access |

## Sites

Manage tower/site locations and assign devices to them.

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{tenant_id}/sites` | viewer | List all sites with health rollup |
| `GET` | `/api/tenants/{tenant_id}/sites/{site_id}` | viewer | Get a single site with health rollup |
| `POST` | `/api/tenants/{tenant_id}/sites` | operator | Create a site |
| `PUT` | `/api/tenants/{tenant_id}/sites/{site_id}` | operator | Update a site |
| `DELETE` | `/api/tenants/{tenant_id}/sites/{site_id}` | admin | Delete a site |
| `POST` | `/api/tenants/{tenant_id}/sites/{site_id}/devices/{device_id}` | operator | Assign a device to a site |
| `DELETE` | `/api/tenants/{tenant_id}/sites/{site_id}/devices/{device_id}` | operator | Remove a device from a site |
| `POST` | `/api/tenants/{tenant_id}/sites/{site_id}/devices/bulk-assign` | operator | Bulk-assign devices to a site |

## Sectors

Manage radio sectors within a site and assign devices to them.

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{tenant_id}/sites/{site_id}/sectors` | viewer | List sectors for a site with device counts |
| `POST` | `/api/tenants/{tenant_id}/sites/{site_id}/sectors` | operator | Create a sector |
| `PUT` | `/api/tenants/{tenant_id}/sites/{site_id}/sectors/{sector_id}` | operator | Update a sector |
| `DELETE` | `/api/tenants/{tenant_id}/sites/{site_id}/sectors/{sector_id}` | admin | Delete a sector |
| `PUT` | `/api/tenants/{tenant_id}/devices/{device_id}/sector` | operator | Set or clear a device's sector assignment |

## Wireless Links

Read-only endpoints for wireless link topology, RF stats, and registrations.

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{tenant_id}/links` | viewer | List all wireless links (optional `state` and `device_id` query filters) |
| `GET` | `/api/tenants/{tenant_id}/devices/{device_id}/links` | viewer | List links where the device is AP or CPE |
| `GET` | `/api/tenants/{tenant_id}/sites/{site_id}/links` | viewer | List links where either side belongs to the site |
| `GET` | `/api/tenants/{tenant_id}/devices/{device_id}/registrations` | viewer | Latest wireless registration data per MAC |
| `GET` | `/api/tenants/{tenant_id}/devices/{device_id}/rf-stats` | viewer | Latest RF monitor stats per interface |
| `GET` | `/api/tenants/{tenant_id}/devices/{device_id}/unknown-clients` | viewer | Wireless clients whose MAC doesn't match any known device |

## Signal History

Time-bucketed signal strength trending for wireless clients.

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{tenant_id}/devices/{device_id}/signal-history` | viewer | Get signal history for a client MAC |

Query parameters:

- `mac_address` (required) -- client MAC address
- `range` -- time range: `24h`, `7d`, or `30d` (default `7d`)

## Site Alerts

Site-scoped alert rules and alert events.

### Alert Rules

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{tenant_id}/sites/{site_id}/alert-rules` | viewer | List alert rules (optional `sector_id` filter) |
| `GET` | `/api/tenants/{tenant_id}/sites/{site_id}/alert-rules/{rule_id}` | viewer | Get a single alert rule |
| `POST` | `/api/tenants/{tenant_id}/sites/{site_id}/alert-rules` | operator | Create an alert rule |
| `PUT` | `/api/tenants/{tenant_id}/sites/{site_id}/alert-rules/{rule_id}` | operator | Update an alert rule |
| `DELETE` | `/api/tenants/{tenant_id}/sites/{site_id}/alert-rules/{rule_id}` | operator | Delete an alert rule |

### Alert Events

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{tenant_id}/sites/{site_id}/alert-events` | viewer | List alert events (optional `state` filter, `limit` up to 200) |
| `POST` | `/api/tenants/{tenant_id}/alert-events/{event_id}/resolve` | operator | Resolve an active alert event |
| `GET` | `/api/tenants/{tenant_id}/alert-events/count` | viewer | Active alert event count (notification badge) |

## Config Backups

Device config backup timeline, restore, and schedule management. All routes are scoped under `/api/tenants/{tenant_id}/devices/{device_id}/config/`.

### Backup Timeline

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `.../config/backups` | viewer | List backup timeline for a device (newest first) |
| `POST` | `.../config/backups` | operator | Trigger a manual config backup |
| `POST` | `.../config/checkpoint` | operator | Create a checkpoint (named restore point) |
| `GET` | `.../config/backups/{commit_sha}/export` | viewer | Download export.rsc text for a backup version |
| `GET` | `.../config/backups/{commit_sha}/binary` | viewer | Download backup.bin for a backup version |

### Restore

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `POST` | `.../config/preview-restore` | operator | Preview impact analysis before restoring a config version |
| `POST` | `.../config/restore` | operator | Restore a config version (two-phase push with panic-revert) |
| `POST` | `.../config/emergency-rollback` | operator | Rollback to most recent pre-push backup |

### Schedules

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `GET` | `.../config/schedules` | viewer | Get effective backup schedule (device override or tenant default) |
| `PUT` | `.../config/schedules` | operator | Create or update device-specific schedule override |

### Config Snapshot

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `POST` | `.../config-snapshot/trigger` | operator | Trigger immediate config snapshot via the Go poller (NATS) |

## Remote Access

SSH terminal and WinBox tunnel sessions. All routes are scoped under `/api/tenants/{tenant_id}/devices/{device_id}/`. Requires operator role or above.

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `POST` | `.../winbox-session` | operator | Open a WinBox tunnel (returns tunnel_id, host, port, winbox:// URI) |
| `DELETE` | `.../winbox-session/{tunnel_id}` | operator | Close a WinBox tunnel (idempotent) |
| `POST` | `.../ssh-session` | operator | Create a single-use SSH WebSocket session token (120s TTL) |
| `GET` | `.../sessions` | operator | List active WinBox tunnels and remote sessions for a device |

The SSH session token authorises a subsequent WebSocket connection at `/ws/ssh?token=<token>`.

## WinBox Remote (Browser)

Xpra-based in-browser WinBox sessions. All routes are scoped under `/api/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/`. Requires operator role or above.

| Method | Endpoint | RBAC | Description |
|--------|----------|------|-------------|
| `POST` | `.../winbox-remote-sessions` | operator | Create a browser WinBox session |
| `GET` | `.../winbox-remote-sessions` | operator | List active sessions for a device |
| `GET` | `.../winbox-remote-sessions/{session_id}` | operator | Get session status |
| `DELETE` | `.../winbox-remote-sessions/{session_id}` | operator | Terminate a session (idempotent) |
| `GET` | `.../winbox-remote-sessions/{session_id}/xpra/{path}` | operator | Proxy Xpra HTML5 client files |
| `WS` | `.../winbox-remote-sessions/{session_id}/ws` | operator | WebSocket proxy (browser to Xpra worker) |

Session creation returns a `websocket_path` for the Xpra WebSocket connection. Sessions enforce idle timeout (default 600s) and max lifetime (default 7200s).

## Multi-Tenancy

Tenant isolation is enforced at the database level via PostgreSQL Row-Level Security (RLS). The `app_user` database role automatically filters all queries by the authenticated user's `tenant_id`. Super admins operate outside tenant scope.
