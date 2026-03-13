# Codebase Structure

**Analysis Date:** 2026-03-12

## Directory Layout

```
the-other-dude/
├── backend/                        # Python FastAPI backend microservice
│   ├── app/
│   │   ├── main.py                 # FastAPI app entry point, lifespan setup
│   │   ├── config.py               # Settings from environment
│   │   ├── database.py             # SQLAlchemy engines, session factories
│   │   ├── models/                 # SQLAlchemy ORM models
│   │   ├── schemas/                # Pydantic request/response schemas
│   │   ├── routers/                # APIRouter endpoints (devices, alerts, auth, etc.)
│   │   ├── services/               # Business logic, NATS subscribers, integrations
│   │   ├── middleware/             # RBAC, tenant context, rate limiting, headers
│   │   ├── security/               # SRP, JWT, auth utilities
│   │   └── templates/              # Jinja2 report templates
│   ├── alembic/                    # Database migrations
│   ├── tests/                      # Unit and integration tests
│   └── Dockerfile
│
├── poller/                         # Go device polling microservice
│   ├── cmd/poller/main.go          # Entry point
│   ├── internal/
│   │   ├── poller/                 # Scheduler and Worker (device polling orchestration)
│   │   ├── device/                 # RouterOS binary API client
│   │   ├── bus/                    # NATS JetStream publisher
│   │   ├── tunnel/                 # WinBox TCP tunnel manager
│   │   ├── sshrelay/               # SSH relay server
│   │   ├── config/                 # Configuration loading
│   │   ├── store/                  # PostgreSQL device list queries
│   │   ├── vault/                  # OpenBao credential cache
│   │   ├── observability/          # Prometheus metrics, health checks
│   │   └── testutil/               # Test helpers
│   ├── go.mod / go.sum
│   └── Dockerfile
│
├── frontend/                       # React 19 TypeScript web UI
│   ├── src/
│   │   ├── routes/                 # TanStack Router file-based routes
│   │   │   ├── __root.tsx          # Root layout, QueryClientProvider
│   │   │   ├── _authenticated.tsx  # Auth guard, logged-in layout
│   │   │   └── _authenticated/     # Tenant and device-scoped pages
│   │   ├── components/             # React components by feature
│   │   │   ├── ui/                 # Base UI components (button, card, dialog, etc.)
│   │   │   ├── dashboard/
│   │   │   ├── fleet/
│   │   │   ├── devices/
│   │   │   ├── config/
│   │   │   ├── alerts/
│   │   │   ├── auth/
│   │   │   ├── vpn/
│   │   │   └── ...
│   │   ├── hooks/                  # Custom React hooks (useEventStream, useShortcut, etc.)
│   │   ├── contexts/               # React Context (EventStreamContext)
│   │   ├── lib/                    # Utilities (API client, crypto, helpers)
│   │   ├── assets/                 # Fonts, images
│   │   └── main.tsx                # Entry point
│   ├── public/
│   ├── package.json / pnpm-lock.yaml
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── Dockerfile
│
├── infrastructure/                 # Deployment and observability configs
│   ├── docker/                     # Docker build scripts
│   ├── helm/                       # Kubernetes Helm charts
│   ├── observability/              # Grafana dashboards, OpenBao configs
│   └── openbao/                    # OpenBao policy and plugin configs
│
├── docs/                           # Documentation
│   ├── website/                    # Website source (theotherdude.net)
│   └── superpowers/                # Feature specs and plans
│
├── scripts/                        # Utility scripts
│
├── docker-compose.yml              # Development multi-container setup
├── docker-compose.override.yml     # Local overrides (mounted volumes, etc.)
├── docker-compose.staging.yml      # Staging environment
├── docker-compose.prod.yml         # Production environment
├── docker-compose.observability.yml # Optional Prometheus/Grafana stack
│
├── .env.example                    # Template environment variables
├── .github/                        # GitHub Actions CI/CD workflows
├── .planning/                      # GSD planning documents
│
└── README.md                       # Main project documentation
```

## Directory Purposes

**backend/app/models/:**
- Purpose: SQLAlchemy ORM model definitions with RLS support
- Contains: Device, User, Tenant, Alert, ConfigBackup, Certificate, AuditLog, Firmware, VPN models
- Key files: `device.py` (devices with status, version, uptime), `user.py` (users with role and tenant), `alert.py` (alert rules and event log)
- Pattern: All models include `tenant_id` column, RLS policies enforce isolation

**backend/app/schemas/:**
- Purpose: Pydantic request/response validation schemas
- Contains: DeviceCreate, DeviceResponse, DeviceUpdate, AlertRuleCreate, ConfigPushRequest, etc.
- Pattern: Separate request/response schemas (response never includes credentials), nested schema reuse

**backend/app/routers/:**
- Purpose: FastAPI APIRouter endpoints, organized by domain
- Key files: `devices.py` (CRUD + bulk ops), `auth.py` (login, SRP, SSE token), `alerts.py` (rules and events), `config_editor.py` (live device config), `metrics.py` (metrics queries), `templates.py` (config templates), `vpn.py` (WireGuard peers)
- Pattern: All routes tenant-scoped as `/api/tenants/{tenant_id}/...` or `/api/...` (user-scoped)
- Middleware: Depends(require_role(...)), Depends(get_current_user), rate limiting

**backend/app/services/:**
- Purpose: Business logic, external integrations, NATS event handling
- Core services: `device.py` (device CRUD with encryption), `auth.py` (SRP, JWT, password hashing), `backup_service.py` (config backup versioning), `ca_service.py` (TLS certificate generation and deployment)
- NATS subscribers: `nats_subscriber.py` (device status), `metrics_subscriber.py` (metrics aggregation), `firmware_subscriber.py` (firmware tracking), `alert_evaluator.py` (alert rule evaluation), `push_rollback_subscriber.py`, `session_audit_subscriber.py`
- External integrations: `email_service.py`, `notification_service.py` (Slack, webhooks), `git_store.py` (config history), `openbao_service.py` (vault access)
- Schedulers: `backup_scheduler.py`, `firmware_subscriber.py` (started/stopped in lifespan)

**backend/app/middleware/:**
- Purpose: Request/response middleware, RBAC, tenant context, rate limiting
- Key files: `tenant_context.py` (JWT extraction, tenant context setup, RLS configuration), `rbac.py` (role hierarchy, Depends factories), `rate_limit.py` (token bucket limiter), `request_id.py` (correlation ID), `security_headers.py` (CSP, HSTS)

**backend/app/security/:**
- Purpose: Authentication and encryption utilities
- Pattern: SRP-6a client challenge/response, JWT token generation, password hashing (bcrypt), credential envelope encryption (Fernet + Transit KMS)

**poller/internal/poller/:**
- Purpose: Device scheduling and polling orchestration
- Key files: `scheduler.go` (lifecycle management, discovery), `worker.go` (per-device polling loop), `interfaces.go` (device interfaces)
- Pattern: Per-device goroutine with Redis distributed locking, circuit breaker with exponential backoff

**poller/internal/device/:**
- Purpose: RouterOS binary API client implementation
- Key files: `client.go` (connection, command execution), `version.go` (parse RouterOS version), `health.go` (CPU, memory, disk metrics), `interfaces.go` (interface stats), `wireless.go` (wireless stats), `firmware.go` (firmware info), `cert_deploy.go` (TLS cert SFTP), `sftp.go` (SFTP operations)
- Pattern: Binary API command builders, response parsers, error handling

**poller/internal/bus/:**
- Purpose: NATS JetStream publisher for all device events
- Key file: `publisher.go` (typed event structs, publish methods)
- Event types: DeviceStatusEvent, DeviceMetricsEvent, ConfigChangedEvent, PushRollbackEvent, PushAlertEvent, SessionAuditEvent
- Pattern: Struct with nc/js connections, methods like PublishDeviceStatus(ctx, event)

**poller/internal/tunnel/:**
- Purpose: WinBox TCP tunnel management
- Key files: `manager.go` (port allocation, tunnel lifecycle), `tunnel.go` (tunnel goroutine), `portpool.go` (ephemeral port pool)
- Pattern: SOCKS proxy forwarding, port reuse after timeout

**poller/internal/sshrelay/:**
- Purpose: SSH server bridging to RouterOS terminal access
- Key files: `server.go` (SSH server setup), `session.go` (SSH session handling), `bridge.go` (SSH-to-device relay)
- Pattern: SSH key pair generation, session multiplexing, terminal protocol bridging

**poller/internal/vault/:**
- Purpose: OpenBao credential caching and decryption
- Key file: `vault.go`
- Pattern: Cache credentials after decryption via Transit KMS, TTL-based eviction

**frontend/src/routes/:**
- Purpose: TanStack Router file-based routing
- Structure: `__root.tsx` (app root, QueryClientProvider), `_authenticated.tsx` (requires JWT, layout), `_authenticated/tenants/$tenantId/index` (tenant home), `_authenticated/tenants/$tenantId/devices/...` (device pages)
- Pattern: Each file exports `Route` object with component and loader, nested routes inherit parent loaders

**frontend/src/components/:**
- Purpose: React components organized by domain/feature
- Structure: `ui/` (base components: Button, Card, Dialog, Input, Select, Badge, Skeleton, etc.), then feature folders (dashboard, fleet, devices, config, alerts, auth, vpn, etc.)
- Pattern: Composition over inheritance, CSS Modules or Tailwind for styling

**frontend/src/hooks/:**
- Purpose: Custom React hooks for reusable logic
- Key files: `useEventStream.ts` (SSE connection lifecycle), `useShortcut.ts` (keyboard shortcuts), `useConfigPanel.ts` (config editor state), `usePageTitle.ts` (document title), `useSimpleConfig.ts` (simple config wizard state)

**frontend/src/lib/:**
- Purpose: Utility modules
- Key files: `api.ts` (axios instance, fetch wrapper), `crypto/` (SRP client, key derivation), helpers (date formatting, validation, etc.)

**backend/alembic/:**
- Purpose: Database schema migrations
- Key files: `alembic/versions/*.py` (timestamped migration scripts)
- Pattern: `upgrade()` and `downgrade()` functions, SQL operations via `op` context

**tests/:**
- Backend: `tests/unit/` (service/model tests), `tests/integration/` (API endpoint tests with test DB)
- Frontend: `tests/e2e/` (Playwright E2E tests), `src/components/__tests__/` (component tests)

## Key File Locations

**Entry Points:**
- Backend: `backend/app/main.py` (FastAPI app, lifespan management)
- Poller: `poller/cmd/poller/main.go` (scheduler initialization)
- Frontend: `frontend/src/main.tsx` (React root), `frontend/src/routes/__root.tsx` (router root)

**Configuration:**
- Backend: `backend/app/config.py` (Settings from .env)
- Poller: `poller/internal/config/config.go` (Load environment)
- Frontend: `frontend/vite.config.ts` (build config), `frontend/tsconfig.json` (TypeScript config)

**Core Logic:**
- Device management: `backend/app/services/device.py` (CRUD), `poller/internal/device/` (API client), `frontend/src/components/fleet/` (UI)
- Config push: `backend/app/routers/config_editor.py` (API), `poller/internal/poller/worker.go` (execution), `frontend/src/components/config-editor/` (UI)
- Alerts: `backend/app/services/alert_evaluator.py` (evaluation logic), `backend/app/routers/alerts.py` (API), `frontend/src/components/alerts/` (UI)
- Authentication: `backend/app/security/` (SRP, JWT), `frontend/src/components/auth/` (forms), `poller/internal/vault/` (credential cache)

**Testing:**
- Backend unit: `backend/tests/unit/`
- Backend integration: `backend/tests/integration/`
- Frontend e2e: `frontend/tests/e2e/` (Playwright specs)
- Poller unit: `poller/internal/poller/*_test.go`, `poller/internal/device/*_test.go`

## Naming Conventions

**Files:**
- Backend Python: snake_case.py (e.g., `device_service.py`, `nats_subscriber.py`)
- Poller Go: snake_case.go (e.g., `poller.go`, `scheduler.go`)
- Frontend TypeScript: PascalCase.tsx for components (e.g., `FleetTable.tsx`), camelCase.ts for utilities (e.g., `useEventStream.ts`)
- Routes: File name maps to URL path (`_authenticated/tenants/$tenantId/devices.tsx` → `/authenticated/tenants/{id}/devices`)

**Functions/Methods:**
- Backend: snake_case (async def list_devices(...)), service functions are async
- Poller: PascalCase for exported types (Scheduler, Publisher), camelCase for methods
- Frontend: camelCase for functions and hooks, PascalCase for component names

**Variables:**
- Backend: snake_case (device_id, tenant_id, current_user)
- Poller: camelCase for small scope (ctx, result), PascalCase for types (DeviceState)
- Frontend: camelCase (connectionState, lastConnectedAt)

**Types:**
- Backend: PascalCase classes (Device, User, DeviceCreate)
- Poller: Exported types PascalCase (DeviceStatusEvent), unexported lowercase (deviceState)
- Frontend: TypeScript interfaces PascalCase (SSEEvent, EventCallback), generics with T

## Where to Add New Code

**New Feature (e.g., new device capability):**
- Primary code:
  - Backend API: `backend/app/routers/{feature}.py` (new router file)
  - Backend service: `backend/app/services/{feature}.py` (business logic)
  - Backend model: Add to `backend/app/models/{domain}.py` or new file
  - Poller: `poller/internal/device/{capability}.go` (RouterOS API client method)
  - Poller event: Add struct to `poller/internal/bus/publisher.go`, new publish method
  - Backend subscriber: `backend/app/services/{feature}_subscriber.py` if async processing needed
- Tests: `backend/tests/integration/test_{feature}.py` (API tests), `backend/tests/unit/test_{service}.py` (service tests)
- Frontend:
  - Route: `frontend/src/routes/_authenticated/{feature}.tsx` (if new top-level page)
  - Component: `frontend/src/components/{feature}/{FeatureName}.tsx`
  - Hook: `frontend/src/hooks/use{FeatureName}.ts` if shared state/logic
- Database: Migration in `backend/alembic/versions/{timestamp}_{description}.py`

**New Component/Module:**
- Backend: Create in `backend/app/services/{module}.py` as async class with methods, import in relevant router/subscriber
- Poller: Create in `poller/internal/{package}/{module}.go`, follow interface pattern in `interfaces.go`
- Frontend: Create in `frontend/src/components/{feature}/{ModuleName}.tsx`, export as named export

**Utilities/Helpers:**
- Backend: `backend/app/services/` (service-level) or `backend/app/` subdirectory (utility modules)
- Poller: `poller/internal/{package}/` (package-level utilities)
- Frontend: `frontend/src/lib/{utility}/` (organized by concern: api, crypto, helpers, etc.)

## Special Directories

**docker-data/:**
- Purpose: Docker volumes for persistent data (PostgreSQL, NATS, Redis, WireGuard configs, Git backups)
- Generated: Yes (created by Docker on first run)
- Committed: No (.gitignore)

**alembic/versions/:**
- Purpose: Database migration history
- Generated: No (manually written by developers)
- Committed: Yes (part of source control for reproducible schema)

**.env files:**
- `.env.example`: Template with non-secret defaults, always committed
- `.env`: Local development config, not committed, ignored by .gitignore
- `.env.staging.example`: Staging environment template

**.planning/codebase/:**
- Purpose: GSD-generated codebase analysis documents (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, etc.)
- Generated: Yes (by GSD tools)
- Committed: Yes (reference for future development)

**node_modules/ (frontend):**
- Purpose: npm/pnpm dependencies
- Generated: Yes (by pnpm install)
- Committed: No (.gitignore)

**__pycache__ (backend), vendor (poller):**
- Purpose: Compiled bytecode and dependency caches
- Generated: Yes
- Committed: No (.gitignore)

---

*Structure analysis: 2026-03-12*
