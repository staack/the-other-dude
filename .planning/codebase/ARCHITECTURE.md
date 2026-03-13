# Architecture

**Analysis Date:** 2026-03-12

## Pattern Overview

**Overall:** Event-driven microservice architecture with asynchronous pub/sub messaging

**Key Characteristics:**
- Three independent microservices: Go Poller, Python FastAPI Backend, React/TypeScript Frontend
- NATS JetStream as central event bus for all inter-service communication
- PostgreSQL with Row-Level Security (RLS) for multi-tenant isolation at database layer
- Real-time Server-Sent Events (SSE) for frontend event streaming
- Distributed task coordination using Redis distributed locks
- Per-tenant encryption via OpenBao Transit KMS engine

## Layers

**Device Polling Layer (Go Poller):**
- Purpose: Connects to RouterOS devices via binary API (port 8729), detects status/version, collects metrics, pushes configs, manages WinBox/SSH tunnels
- Location: `poller/`
- Contains: Device client, scheduler, SSH relay, WinBox tunnel manager, NATS publisher, Redis credential cache, OpenBao vault client
- Depends on: NATS JetStream, Redis, PostgreSQL (read-only for device list), OpenBao
- Used by: Publishes events to backend via NATS

**Event Bus Layer (NATS JetStream):**
- Purpose: Central publish/subscribe message broker for all service-to-service communication
- Streams: DEVICE_EVENTS, OPERATION_EVENTS, ALERT_EVENTS
- Contains: Device status changes, metrics, config change notifications, push rollback triggers, alert events, session audit events
- All events include device_id and tenant_id for multi-tenant routing

**Backend API Layer (Python FastAPI):**
- Purpose: RESTful API, business logic, database persistence, event subscription and processing
- Location: `backend/app/`
- Contains: FastAPI routers, SQLAlchemy ORM models, async services, NATS subscribers, middleware (RBAC, tenant context, rate limiting)
- Depends on: PostgreSQL (via RLS-enforced app_user connection), NATS JetStream, Redis, OpenBao, email/webhook services
- Used by: Frontend (REST API), poller (reads device list, writes operation results)

**Data Persistence Layer (PostgreSQL + TimescaleDB):**
- Purpose: Multi-tenant relational data store with RLS-enforced isolation
- Connection: Two engines in `backend/app/database.py`
  - Admin engine (superuser): Migrations, bootstrap, admin operations
  - App engine (app_user role): All tenant-scoped API requests, RLS enforced
- Row-Level Security: `SET LOCAL app.current_tenant` set per-request by `get_current_user` dependency
- Contains: Devices, users, tenants, alerts, config backups, templates, VPN peers, certificates, audit logs, metrics aggregates

**Caching/Locking Layer (Redis):**
- Purpose: Distributed locks (poller prevents duplicate device polls), session management, temporary data
- Usage: `redislock` package in poller for per-device poll coordination across replicas

**Secret Management Layer (OpenBao):**
- Purpose: Transit KMS for per-tenant envelope encryption, credential storage access control
- Mode: Transit secret engine wrapping credentials for envelope encryption
- Accessed by: Poller (fetch decrypted credentials), backend (re-encrypt on password change)

**Frontend Layer (React 19 + TanStack):**
- Purpose: Web UI for fleet management, device control, configuration, monitoring
- Location: `frontend/src/`
- Contains: TanStack Router, TanStack Query, Tailwind CSS, SSE event stream integration, WebSocket tunnels
- Depends on: Backend REST API, Server-Sent Events for real-time updates, WebSocket for terminal/remote access
- Entry point: `frontend/src/routes/__root.tsx` (QueryClientProvider, root layout)

## Data Flow

**Device Status Polling (Poller → NATS → Backend):**

1. Poller scheduler periodically fetches device list from PostgreSQL
2. For each device, poller's `Worker` connects to RouterOS binary API (port 8729 TLS)
3. Worker collects device status (online/offline), version, system metrics
4. Worker publishes `DeviceStatusEvent` to NATS stream `DEVICE_EVENTS` topic `device.status.{device_id}`
5. Backend subscribes to `device.status.>` via `nats_subscriber.py`
6. Subscriber updates device record in PostgreSQL via admin session (bypasses RLS)
7. Frontend receives update via SSE subscription to `/api/sse?topics=device_status`

**Configuration Push (Frontend → Backend → Poller → Router):**

1. Frontend calls `POST /api/tenants/{tenant_id}/devices/{device_id}/config` with new configuration
2. Backend stores config in PostgreSQL, publishes `ConfigPushEvent` to `OPERATION_EVENTS`
3. Poller subscribes to push operation events, receives config delta
4. Poller connects to device via binary API, executes RouterOS commands (two-phase: backup, apply, verify)
5. On completion, poller publishes `ConfigPushCompletedEvent` to NATS
6. Backend subscriber updates operation record with success/failure
7. Frontend notifies user via SSE

**Metrics Collection (Poller → NATS → Backend → Frontend):**

1. Poller collects health metrics (CPU, memory, disk), interface stats, wireless stats per poll cycle
2. Publishes `DeviceMetricsEvent` to `DEVICE_EVENTS` topic `device.metrics.{type}.{device_id}`
3. Backend `metrics_subscriber.py` aggregates into TimescaleDB hypertables
4. Frontend queries `/api/tenants/{tenant_id}/devices/{device_id}/metrics` for graphs
5. Alternatively, frontend SSE stream pushes metric updates for real-time graphs

**Real-Time Event Streaming (Backend → Frontend via SSE):**

1. Frontend calls `POST /api/auth/sse-token` to exchange session cookie for short-lived SSE bearer token
2. Token valid for 25 seconds (refreshed every 25 seconds before expiry)
3. Frontend opens EventSource to `/api/sse?topics=device_status,alert_fired,config_push,firmware_progress,metric_update`
4. Backend maintains SSE connections, pushes events from NATS subscribers
5. Reconnection on disconnect with exponential backoff (1s → 30s max)

**Multi-Tenant Isolation (Request → Middleware → RLS):**

1. Frontend sends JWT token in Authorization header or httpOnly cookie
2. Backend `tenant_context.py` middleware extracts user from JWT, determines tenant_id
3. Middleware calls `SET LOCAL app.current_tenant = '{tenant_id}'` on the database session
4. All subsequent queries automatically filtered by RLS policy `(tenant_id = current_setting('app.current_tenant'))`
5. Superadmin can re-set tenant context to access any tenant
6. Admin sessions (migrations, NATS subscribers) use superuser connection, handle tenant routing explicitly

**State Management:**

- Frontend: TanStack Query for server state (device list, metrics, config), React Context for session/auth state
- Backend: Async SQLAlchemy ORM with automatic transaction management per request
- Poller: In-memory device state map with per-device circuit breaker tracking failures and backoff
- Shared: Redis for distributed locks, NATS for event persistence (JetStream replays)

## Key Abstractions

**Device Client (`poller/internal/device/`):**
- Purpose: Binary API communication with RouterOS devices
- Files: `client.go`, `version.go`, `health.go`, `interfaces.go`, `wireless.go`, `firmware.go`, `cert_deploy.go`, `sftp.go`
- Pattern: RouterOS binary API command execution, metric parsing and extraction
- Usage: Worker polls device state and metrics in parallel goroutines

**Scheduler & Worker (`poller/internal/poller/scheduler.go`, `worker.go`):**
- Purpose: Orchestrate per-device polling goroutines with circuit breaker resilience
- Pattern: Per-device goroutine with Redis distributed locking to prevent duplicate polls across replicas
- Lifecycle: Discover new devices from DB, create goroutine; remove devices, cancel goroutine
- Circuit Breaker: Exponential backoff after N consecutive failures, resets on success

**NATS Publisher (`poller/internal/bus/publisher.go`):**
- Purpose: Publish typed device events to JetStream streams
- Event types: DeviceStatusEvent, DeviceMetricsEvent, ConfigChangedEvent, PushRollbackEvent, PushAlertEvent
- Each event includes device_id and tenant_id for multi-tenant routing
- Consumers: Backend subscribers, audit logging, alert evaluation

**Tunnel Manager (`poller/internal/tunnel/manager.go`):**
- Purpose: Manage WinBox TCP tunnels to devices (port-forwarded SOCKS proxies)
- Port pool: Allocate ephemeral local ports for tunnel endpoints
- Pattern: Accept local connections on port, tunnel to device's WinBox port via binary API

**SSH Relay (`poller/internal/sshrelay/server.go`, `session.go`, `bridge.go`):**
- Purpose: SSH terminal access to RouterOS devices for remote management
- Pattern: SSH server on poller, bridges SSH sessions to RouterOS via binary API terminal protocol
- Authentication: SSH key or password relay from frontend

**FastAPI Router Pattern (`backend/app/routers/`):**
- Files: `devices.py`, `auth.py`, `alerts.py`, `config_editor.py`, `templates.py`, `metrics.py`, etc.
- Pattern: APIRouter with Depends() for RBAC, tenant context, rate limiting
- All routes tenant-scoped under `/api/tenants/{tenant_id}/...`
- RLS enforcement: Automatic via `SET LOCAL app.current_tenant` in `get_current_user` middleware

**Async Service Layer (`backend/app/services/`):**
- Purpose: Business logic, database operations, integration with external systems
- Files: `device.py`, `auth.py`, `backup_service.py`, `ca_service.py`, `alert_evaluator.py`, etc.
- Pattern: Async functions using AsyncSession, composable for multiple operations in single transaction
- NATS Integration: Subscribers consume events, services update database accordingly

**NATS Subscribers (`backend/app/services/*_subscriber.py`):**
- Purpose: Consume events from NATS JetStream, update application state
- Lifecycle: Started/stopped in FastAPI lifespan context manager
- Examples: `nats_subscriber.py` (device status), `metrics_subscriber.py` (metrics aggregation), `firmware_subscriber.py` (firmware update tracking)
- Pattern: JetStream consumer with durable name, explicit message acking for reliability

**Frontend Router (`frontend/src/routes/`):**
- Pattern: TanStack Router file-based routing
- Structure: `_authenticated.tsx` (layout for logged-in users), `_authenticated/tenants/$tenantId/devices/...` (device management)
- Entry: `__root.tsx` (QueryClientProvider setup), `_authenticated.tsx` (auth check + layout)

**Frontend Event Stream Hook (`frontend/src/hooks/useEventStream.ts`):**
- Purpose: Manage SSE connection lifecycle, handle reconnection, parse event payloads
- Pattern: useRef for connection state, setInterval for token refresh, EventSource API
- Callbacks: Per-event-type handlers registered by components
- State: Managed in EventStreamContext for app-wide access

## Entry Points

**Poller Binary (`poller/cmd/poller/main.go`):**
- Location: `poller/cmd/poller/main.go`
- Triggers: Docker container start, Kubernetes pod initialization
- Responsibilities: Load config, initialize NATS/Redis/PostgreSQL connections, start scheduler, setup observability (Prometheus metrics, structured logging)
- Config source: Environment variables (see `poller/internal/config/config.go`)

**Backend API (`backend/app/main.py`):**
- Location: `backend/app/main.py`
- Triggers: Docker container start, uvicorn ASGI server
- Responsibilities: Configure logging, run migrations, bootstrap first admin, start NATS subscribers, setup middleware, register routers
- Lifespan: Async context manager handles startup/shutdown of services
- Health check: `/api/health` endpoint, `/api/readiness` for k8s

**Frontend Entry (`frontend/src/routes/__root.tsx`):**
- Location: `frontend/src/routes/__root.tsx`
- Triggers: Browser loads app at `/`
- Responsibilities: Wrap app in QueryClientProvider (TanStack Query), setup root error boundary
- Auth flow: Routes under `_authenticated` check JWT token, redirect to login if missing
- Real-time setup: Establish SSE connection via `useEventStream` hook in layout

## Error Handling

**Strategy:** Three-tier error handling across services

**Patterns:**

- **Poller**: Circuit breaker exponential backoff for device connection failures. Logs all errors to structured JSON with context (device_id, tenant_id, attempt number). Publishes failure events to NATS for alerting.

- **Backend**: FastAPI exception handlers convert service errors to HTTP responses. RLS violations return 403 Forbidden. Invalid tenant access returns 404. Database errors logged via structlog with request_id middleware for correlation.

- **Frontend**: TanStack Query retry logic (1 retry by default), error boundaries catch component crashes, toast notifications display user-friendly error messages, RequestID middleware propagates correlation IDs

## Cross-Cutting Concerns

**Logging:**
- Poller: `log/slog` with JSON handler, structured fields (service, device_id, tenant_id, operation)
- Backend: `structlog` with async logger, JSON output in production
- Frontend: Browser console + error tracking (if configured)

**Validation:**
- Backend: Pydantic models (`app/schemas/`) enforce request shape and types, custom validators for business logic (e.g., SRP challenge validation)
- Frontend: TanStack Form for client-side validation before submission
- Database: PostgreSQL CHECK constraints and unique indexes

**Authentication:**
- Zero-knowledge SRP-6a for initial password enrollment (client never sends plaintext)
- JWT tokens issued after SRP enrollment, stored as httpOnly cookies
- Optional API keys with scoped access for programmatic use
- SSE token exchange for event stream access (short-lived, single-use)

**Authorization (RBAC):**
- Four roles: super_admin (all access), tenant_admin (full tenant access), operator (read+config), viewer (read-only)
- Role hierarchy enforced by `require_role()` dependency in routers
- API key scopes: subset of operator permissions (read, write_device, write_config, etc.)

**Rate Limiting:**
- Backend: Token bucket limiter on sensitive endpoints (login, token generation, device operations)
- Configuration: `app/middleware/rate_limit.py` defines limits per endpoint
- Redis-backed for distributed rate limit state

**Multi-Tenancy:**
- Database RLS: All tables have `tenant_id`, policy enforces current_tenant filter
- Tenant context: Middleware extracts from JWT, sets `app.current_tenant` local variable
- Superadmin bypass: Can re-set tenant context to access any tenant
- Admin operations: Use superuser connection, explicit tenant routing

---

*Architecture analysis: 2026-03-12*
