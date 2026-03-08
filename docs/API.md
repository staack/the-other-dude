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
| Metrics | `/api/metrics/*` | TimescaleDB device metrics (CPU, memory, traffic) |
| Config Backups | `/api/config-backups/*` | Automated RouterOS config backup history |
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

## Multi-Tenancy

Tenant isolation is enforced at the database level via PostgreSQL Row-Level Security (RLS). The `app_user` database role automatically filters all queries by the authenticated user's `tenant_id`. Super admins operate outside tenant scope.
