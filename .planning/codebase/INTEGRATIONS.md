# External Integrations

**Analysis Date:** 2026-03-12

## APIs & External Services

**MikroTik RouterOS:**
- Binary API (TLS port 8729) - Device polling and command execution
  - SDK/Client: go-routeros/v3 (Go poller)
  - Protocol: Binary encoded commands, TLS mutual authentication
  - Used in: `poller/cmd/poller/main.go`, `poller/internal/poller/`

**SMTP (Transactional Email):**
- System email service (password reset, alerts, notifications)
  - SDK/Client: aiosmtplib (async SMTP library)
  - Configuration: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_USE_TLS`
  - From address: `SMTP_FROM_ADDRESS`
  - Implementation: `app/services/email_service.py`
  - Supports TLS, STARTTLS, plain auth

**WebSocket/SSH Tunneling:**
- Browser-based SSH terminal for remote device access
  - SDK/Client: asyncssh (Python), xterm.js (frontend)
  - Protocol: SSH protocol with port forwarding
  - Implementation: `app/routers/remote_access.py`, `poller/internal/sshrelay/`
  - Features: Session auditing, command logging to NATS

## Data Storage

**Databases:**
- PostgreSQL 17 (TimescaleDB extension in production)
  - Async driver: asyncpg 0.30.0+ (Python backend)
  - Sync driver: pgx/v5 (Go poller)
  - ORM: SQLAlchemy 2.0+ async
  - Migrations: Alembic 1.14.0+
  - RLS: Row-Level Security policies for multi-tenant isolation
  - Models: `app/models/` (17+ model files)
  - Connection: `DATABASE_URL`, `APP_USER_DATABASE_URL`, `POLLER_DATABASE_URL`
  - Admin role: postgres (migrations only)
  - App role: app_user (enforces RLS)
  - Poller role: poller_user (direct access, no RLS)

**File Storage:**
- Local filesystem only - No cloud storage integration
  - Git store (bare repos): `/data/git-store` or `./git-store` (RWX PVC in production)
    - Implementation: `app/services/git_store.py`
    - Purpose: Version control for device configurations (one repo per tenant)
  - Firmware cache: `/data/firmware-cache`
    - Purpose: Downloaded RouterOS firmware images
    - Service: `app/services/firmware_service.py`
  - WireGuard config: `/data/wireguard`
    - Purpose: VPN peer and configuration management

**Caching:**
- Redis 7+
  - Async driver: redis 5.0.0+ (Python)
  - Sync driver: redis/go-redis/v9 (Go)
  - Use cases:
    - Session storage for SRP auth flows: `app/routers/auth.py` (key: `srp:session:{session_id}`)
    - Distributed locks: poller uses `bsm/redislock` to prevent duplicate polls across replicas
  - Connection: `REDIS_URL`

## Authentication & Identity

**Auth Provider:**
- Custom SRP-6a implementation (zero-knowledge auth)
  - Flow: SRP-6a password hash registration → no plaintext password stored
  - Implementation: `app/services/srp_service.py`, `app/routers/auth.py`
  - JWT tokens: HS256 signed with `JWT_SECRET_KEY`
  - Token storage: httpOnly cookies (frontend sends via credentials)
  - Refresh: 15-minute access tokens, 7-day refresh tokens
  - Fallback: Legacy bcrypt password support during upgrade phase

**User Roles:**
- Four role levels with RBAC:
  - super_admin - Cross-tenant access, user/billing management
  - admin - Full tenant management (invite users, config push, firmware)
  - operator - Limited: config push, monitoring, alerts
  - viewer - Read-only: dashboard, reports, audit logs

**Credential Encryption:**
- Per-tenant envelope encryption via OpenBao Transit
  - Service: `app/services/openbao_service.py`
  - Cipher: AES-256-GCM via OpenBao Transit engine
  - Key naming: `tenant_{uuid}` (created on tenant creation)
  - Fallback: Legacy Fernet decryption for credentials created before Transit migration

## Monitoring & Observability

**Error Tracking:**
- Not integrated - No Sentry, DataDog, or equivalent
- Local structured logging only

**Logs:**
- Structured logging via structlog (Python backend)
  - Format: JSON (production), human-readable (dev)
  - Configuration: `app/logging_config.py`
  - Log level: Configurable via `LOG_LEVEL` env var
- Structured logging via slog (Go poller)
  - Format: JSON with service name and instance hostname
  - Configuration: `poller/cmd/poller/main.go`

**Metrics:**
- Prometheus metrics export
  - Library: prometheus-fastapi-instrumentator 7.0.0+
  - Setup: `app/observability.py`
  - Endpoint: Exposed metrics in Prometheus text format
  - Not scraped by default - requires external Prometheus instance

**OpenTelemetry:**
- Minimal OTEL instrumentation in Go poller
  - SDK: `go.opentelemetry.io/otel` 1.39.0+
  - Not actively used in Python backend

## CI/CD & Deployment

**Hosting:**
- Self-hosted (Docker Compose for local, Kubernetes for production)
- No cloud provider dependency
- Reverse proxy: Caddy (reference: user memory notes)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/`)
- Not fully analyzed - check workflows for details

**Containers:**
- Docker multi-stage builds for all three services
- Images: `api` (FastAPI), `poller` (Go binary), `frontend` (Vite SPA)
- Profiles: `full` (all services), `mail-testing` (adds Mailpit)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL admin connection
- `SYNC_DATABASE_URL` - Alembic migrations connection
- `APP_USER_DATABASE_URL` - App-scoped RLS connection
- `POLLER_DATABASE_URL` - Poller service connection
- `REDIS_URL` - Redis connection
- `NATS_URL` - NATS JetStream connection
- `JWT_SECRET_KEY` - HS256 signing key (MUST be unique in production)
- `CREDENTIAL_ENCRYPTION_KEY` - Base64-encoded 32-byte AES key
- `OPENBAO_ADDR` - OpenBao server address
- `OPENBAO_TOKEN` - OpenBao authentication token
- `CORS_ORIGINS` - Frontend origins (comma-separated)
- `SMTP_HOST`, `SMTP_PORT` - Email server
- `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_PASSWORD` - Bootstrap account (dev only)

**Secrets location:**
- `.env` file (git-ignored) - Development
- Environment variables in production (Kubernetes secrets, docker compose .env)
- OpenBao - Stores Transit encryption keys (not key material, only key references)

**Security defaults validation:**
- `app/config.py` rejects known-insecure values in non-dev environments:
  - `JWT_SECRET_KEY` hard-coded defaults
  - `CREDENTIAL_ENCRYPTION_KEY` hard-coded defaults
  - `OPENBAO_TOKEN` hard-coded defaults
- Fails startup with clear error message if production uses dev secrets

## Webhooks & Callbacks

**Incoming:**
- None detected - No external webhook subscriptions

**Outgoing:**
- Slack notifications - Alert firing/resolution (planned/partial implementation)
  - Router: `app/routers/alerts.py`
  - Implementation status: Check alert evaluation service
- Email notifications - Alert notifications, password reset
  - Service: `app/services/email_service.py`
- Custom webhooks - Extensible via notification service
  - Service: `app/services/notification_service.py`

## NATS JetStream Event Bus

**Message Bus:**
- NATS 2.0+ with JetStream persistence
  - Python client: nats-py 2.7.0+
  - Go client: nats.go 1.38.0+
  - Connection: `NATS_URL`

**Event Topics (Python publisher → Go/Python subscribers):**
- `device.status.>` - Device online/offline status from Go poller
  - Subscriber: `app/services/nats_subscriber.py`
  - Payload: device_id, tenant_id, status, routeros_version, board_name, uptime
  - Usage: Real-time device fleet updates

- `firmware.progress.{tenant_id}.{device_id}` - Firmware upgrade progress
  - Subscriber: `app/services/firmware_subscriber.py`
  - Publisher: Firmware upgrade service
  - Payload: stage (downloading, verifying, upgrading), progress %, message
  - Usage: Live firmware upgrade tracking (SSE to frontend)

- `config.push.{tenant_id}.{device_id}` - Configuration push progress
  - Subscriber: `app/services/push_rollback_subscriber.py`
  - Publisher: `app/services/restore_service.py`
  - Payload: phase (pre-validate, backup, push, commit), status, errors
  - Usage: Live config deployment tracking with rollback support

- `alert.fired.{tenant_id}`, `alert.resolved.{tenant_id}` - Alert events
  - Subscriber: `app/services/sse_manager.py`
  - Publisher: `app/services/alert_evaluator.py`
  - Payload: alert_id, device_id, rule_name, condition, value, timestamp
  - Usage: Real-time alert notifications (SSE to frontend)

- `audit.session.end` - SSH session audit events
  - Subscriber: `app/services/session_audit_subscriber.py`
  - Publisher: Go SSH relay (`poller/internal/sshrelay/`)
  - Payload: session_id, user_id, device_id, start_time, end_time, command_log
  - Usage: Session auditing and compliance logging

- `config.change.{tenant_id}.{device_id}` - Device config change detection
  - Subscriber: `app/services/config_change_subscriber.py`
  - Payload: device_id, change_type, affected_subsystems, timestamp
  - Usage: Track unapproved config changes

- `metrics.sample.{tenant_id}.{device_id}` - Real-time CPU/memory/traffic samples
  - Subscriber: `app/services/metrics_subscriber.py`
  - Publisher: Go poller
  - Payload: timestamp, cpu_percent, memory_percent, disk_percent, interfaces{name, rx_bytes, tx_bytes}
  - Usage: Live metric streaming (SSE to frontend)

**Server-Sent Events (SSE):**
- Frontend subscribes to per-tenant SSE streams
  - Endpoint: `GET /api/sse/subscribe?tenant_id={tenant_id}`
  - Connection: Long-lived HTTP persistent stream
  - Implementation: `app/routers/sse.py`, `app/services/sse_manager.py`
  - Payload format: SSE (text/event-stream)
  - Events forwarded from NATS to frontend browser in real-time
  - Used for: firmware progress, alerts, config push status, metrics

## Git Integration

**Version Control:**
- Bare git repositories stored per-tenant
  - Library: pygit2 1.14.0+
  - Location: `{GIT_STORE_PATH}/tenant_{tenant_id}/`
  - Purpose: Store device configuration history
  - Commits created on: successful config push, manual save
  - Restore: One-click revert to any previous commit
  - Implementation: `app/services/git_store.py`

---

*Integration audit: 2026-03-12*
