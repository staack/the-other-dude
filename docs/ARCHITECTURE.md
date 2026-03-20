# Architecture

## System Overview

TOD (The Other Dude) is a containerized MSP fleet management platform for MikroTik RouterOS devices. It uses a three-service architecture: a React frontend, a Python FastAPI backend, and a Go poller. All services communicate through PostgreSQL, Redis, and NATS JetStream. Multi-tenancy is enforced at the database level via PostgreSQL Row-Level Security (RLS).

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend API   │◀───▶│   Go Poller  │
│  React/nginx │     │    FastAPI       │     │  go-routeros │
└─────────────┘     └────────┬────────┘     └──────┬───────┘
                             │                      │
              ┌──────────────┼──────────────────────┤
              │              │                      │
     ┌────────▼──┐    ┌──────▼──────┐    ┌──────────▼──┐
     │   Redis    │    │ PostgreSQL  │    │    NATS      │
     │  locks,    │    │ 17 + Timescale│   │  JetStream   │
     │  cache     │    │ DB + RLS    │    │  pub/sub     │
     └───────────┘    └─────────────┘    └─────────────┘
                                                │
                                         ┌──────▼──────┐
                                         │  OpenBao     │
                                         │  Transit KMS │
                                         └─────────────┘
```

## Services

### Frontend (React / nginx)

- **Stack**: React 19, TypeScript, TanStack Router (file-based routing), TanStack Query (data fetching), Tailwind CSS 3.4, Vite
- **Production**: Static build served by nginx on port 80 (exposed as port 3000)
- **Development**: Vite dev server with hot module replacement
- **Design system**: Geist Sans + Geist Mono fonts, HSL color tokens via CSS custom properties, class-based dark/light mode
- **Real-time**: Server-Sent Events (SSE) for live device status updates, alerts, and operation progress
- **Client-side encryption**: SRP-6a authentication flow with 2SKD key derivation; Emergency Kit PDF generation
- **UX features**: Command palette (Cmd+K), Framer Motion page transitions, collapsible sidebar, skeleton loaders
- **Memory limit**: 64MB

### Backend API (FastAPI)

- **Stack**: Python 3.12+, FastAPI 0.115+, SQLAlchemy 2.0 async, asyncpg, Gunicorn
- **Two database engines**:
  - `admin_engine` (superuser) -- used only for auth/bootstrap and NATS subscribers that need cross-tenant access
  - `app_engine` (non-superuser `app_user` role) -- used for all device/data routes, enforces RLS
- **Authentication**: JWT tokens (15min access, 7d refresh), SRP-6a zero-knowledge proof, RBAC (super_admin, admin, operator, viewer)
- **NATS subscribers**: Ten independent subscribers, each on its own NATS connection. Non-fatal startup -- API serves requests even if NATS is unavailable:
  - `nats_subscriber` -- device status events
  - `metrics_subscriber` -- device metrics (CPU, memory, interface counters)
  - `firmware_subscriber` -- firmware version events
  - `session_audit_subscriber` -- SSH session auditing
  - `config_change_subscriber` -- event-driven config backups
  - `push_rollback_subscriber` -- config push rollback and alerting
  - `config_snapshot_subscriber` -- config snapshot ingestion (Go poller -> PostgreSQL via Transit encryption)
  - `wireless_registration_subscriber` -- per-client wireless registration data
  - `interface_subscriber` -- device interface MAC resolution for link discovery
  - `link_discovery_subscriber` -- wireless link state machine (MAC-based AP/CPE pairing)
- **Background services**:
  - APScheduler: nightly config backups, daily firmware version checks, retention cleanup (24h cycle)
  - WinBox session reconciliation loop (60s cycle) -- detects orphaned sessions and cleans up Redis + tunnels
  - Signal trend detection loop (hourly) -- identifies sustained signal degradation across wireless clients
  - Site alert evaluation loop (5-minute cycle) -- evaluates geographic-scoped alert rules with hysteresis
- **OpenBao integration**: Provisions per-tenant Transit encryption keys on startup, dual-read fallback if OpenBao is unavailable
- **Startup sequence**: Configure logging -> Run Alembic migrations -> Bootstrap first admin -> Start NATS subscribers (10) -> Ensure SSE streams -> Start schedulers -> Provision OpenBao keys -> Recover stale push operations -> Start background loops (reconciliation, trend detection, site alerts)
- **API documentation**: OpenAPI docs at `/docs` and `/redoc` (dev environment only)
- **Health endpoints**: `/health` (liveness), `/health/ready` (readiness -- checks PostgreSQL, Redis, NATS)
- **Middleware stack** (LIFO order): RequestID -> SecurityHeaders -> RateLimiting -> CORS -> Route handler
- **Memory limit**: 512MB

#### API Routers

The backend exposes 33 route groups under the `/api` prefix:

| Router | Purpose |
|--------|---------|
| `auth` | Login (SRP-6a + legacy), token refresh, registration |
| `tenants` | Tenant CRUD (super_admin only) |
| `users` | User management, RBAC |
| `devices` | Device CRUD, status, commands |
| `device_groups` | Logical device grouping |
| `device_tags` | Tagging and filtering |
| `metrics` | Time-series metrics (TimescaleDB) |
| `config_backups` | Configuration backup history |
| `config_editor` | Live RouterOS config editing |
| `firmware` | Firmware version tracking and upgrades |
| `alerts` | Alert rules and active alerts |
| `events` | Device event log |
| `device_logs` | RouterOS system logs |
| `templates` | Configuration templates |
| `clients` | Connected client devices |
| `topology` | Network topology (ReactFlow data) |
| `sse` | Server-Sent Events streams |
| `audit_logs` | Immutable audit trail |
| `reports` | PDF report generation (Jinja2 + weasyprint) |
| `api_keys` | API key management (mktp_ prefix) |
| `maintenance_windows` | Scheduled maintenance with alert suppression |
| `vpn` | WireGuard VPN management |
| `certificates` | Internal CA and device TLS certificates |
| `settings` | System settings (SMTP configuration, super_admin only) |
| `transparency` | KMS access event dashboard |
| `remote_access` | SSH remote access sessions |
| `winbox_remote` | WinBox browser-based remote sessions |
| `sites` | Site management (hierarchical device organization) |
| `sectors` | Sector definitions within sites (antenna/coverage zones) |
| `links` | Wireless link discovery and state tracking |
| `signal_history` | Per-client signal strength history and trends |
| `site_alerts` | Geographic-scoped alert rules and events |
| `config` | Config push operations (two-phase with panic revert) |

### Go Poller

- **Stack**: Go 1.25, go-routeros/v3, pgx/v5, nats.go
- **Polling model**: Synchronous per-device polling on a configurable interval (default 60s)
- **Device communication**: RouterOS binary API over TLS (port 8729), InsecureSkipVerify for self-signed certs
- **TLS fallback**: Three-tier strategy -- CA-verified -> InsecureSkipVerify -> plain API
- **Distributed locking**: Redis locks prevent concurrent polling of the same device (safe for multi-instance deployment)
- **Circuit breaker**: Backs off from unreachable devices to avoid wasting poll cycles
- **Credential decryption**: OpenBao Transit with LRU cache (1024 entries, 5min TTL) to minimize KMS calls
- **Output**: Publishes poll results to NATS JetStream; the API's NATS subscribers process and persist them
- **Database access**: Uses `poller_user` role which bypasses RLS (needs cross-tenant device access)
- **VPN routing**: Adds static route to WireGuard gateway for reaching remote devices
- **Tunnel manager**: On-demand TCP proxy for WinBox connections; allocates ports from a configurable range (default 49000–49100), bound to localhost only, with idle-timeout cleanup
- **SSH relay**: WebSocket-to-SSH bridge serving browser-based terminal sessions; listens on port 8080, enforces per-user and per-device session limits
- **Memory limit**: 512MB

## Infrastructure Services

### PostgreSQL 17 + TimescaleDB

- **Image**: `timescale/timescaledb:2.17.2-pg17`
- **Row-Level Security (RLS)**: Enforces tenant isolation at the database level. All data tables have a `tenant_id` column; RLS policies filter by `current_setting('app.current_tenant')`
- **Database roles**:
  - `postgres` (superuser) -- admin engine, auth/bootstrap, migrations
  - `app_user` (non-superuser) -- RLS-enforced, used by API for data routes
  - `poller_user` -- bypasses RLS, used by Go poller for cross-tenant device access
- **TimescaleDB hypertables**: Time-series storage for device metrics (CPU, memory, interface traffic, etc.)
- **Migrations**: Alembic, run automatically on API startup
- **Initialization**: `scripts/init-postgres.sql` creates roles and enables extensions
- **Data volume**: `./docker-data/postgres`
- **Memory limit**: 512MB

### Redis

- **Image**: `redis:7-alpine`
- **Uses**:
  - Distributed locking for the Go poller (prevents concurrent polling of the same device)
  - Rate limiting on auth endpoints (5 requests/min)
  - Credential cache for OpenBao Transit responses
- **Data volume**: `./docker-data/redis`
- **Memory limit**: 128MB

### NATS JetStream

- **Image**: `nats:2-alpine`
- **Role**: Message bus between the Go poller and the Python API
- **Streams**: DEVICE_EVENTS (poll results, status changes), ALERT_EVENTS (SSE delivery), OPERATION_EVENTS (SSE delivery)
- **Durable consumers**: Ensure no message loss during API restarts
- **Monitoring port**: 8222
- **Data volume**: `./docker-data/nats`
- **Memory limit**: 256MB

### OpenBao (HashiCorp Vault fork)

- **Image**: `openbao/openbao:2.1`
- **Mode**: Persistent server with file storage backend (`/openbao/data`), mounted to the `openbao_data` Docker volume. Data survives container restarts.
- **Transit secrets engine**: Provides envelope encryption for device credentials at rest
- **Per-tenant keys**: Each tenant gets a dedicated Transit encryption key
- **Init script**: `infrastructure/openbao/init.sh` enables Transit engine and creates initial keys
- **Token**: Set `OPENBAO_TOKEN` in `.env.prod`. The application rejects known-insecure defaults in production.
- **Memory limit**: 256MB

### WireGuard

- **Image**: `lscr.io/linuxserver/wireguard`
- **Role**: VPN gateway for reaching RouterOS devices on remote networks
- **Port**: 51820/UDP
- **Routing**: API and Poller containers add static routes through the WireGuard container to reach device subnets (e.g., `10.10.0.0/16`)
- **Data volume**: `./docker-data/wireguard`
- **Memory limit**: 128MB

## Data Flow

### Device Polling Cycle

```
Go Poller                   Redis           OpenBao         RouterOS        NATS            API             PostgreSQL
   │                          │                │               │              │               │                │
   ├──query device list──────▶│                │               │              │               │                │
   │◀─────────────────────────┤                │               │              │               │                │
   ├──acquire lock────────────▶│               │               │              │               │                │
   │◀──lock granted───────────┤                │               │              │               │                │
   ├──decrypt credentials (cache miss)────────▶│               │              │               │                │
   │◀──plaintext credentials──────────────────┤               │              │               │                │
   ├──binary API (8729 TLS)───────────────────────────────────▶│              │               │                │
   │◀──system info, interfaces, metrics───────────────────────┤              │               │                │
   ├──publish poll result──────────────────────────────────────────────────▶│               │                │
   │                          │                │               │              │  ──subscribe──▶│                │
   │                          │                │               │              │               ├──upsert data──▶│
   ├──release lock────────────▶│               │               │              │               │                │
```

1. Poller queries PostgreSQL for the list of active devices
2. Acquires a Redis distributed lock per device (prevents duplicate polling)
3. Decrypts device credentials via OpenBao Transit (LRU cache avoids repeated KMS calls)
4. Connects to the RouterOS binary API on port 8729 over TLS
5. Collects system info, interface stats, routing tables, and metrics
6. Publishes results to NATS JetStream
7. API NATS subscriber processes results and upserts into PostgreSQL
8. Releases Redis lock

### Config Push (Two-Phase with Panic Revert)

```
Frontend        API           RouterOS
   │              │               │
   ├──push config─▶│              │
   │              ├──apply config─▶│
   │              ├──set revert timer─▶│
   │              │◀──ack────────┤
   │◀──pending────┤              │
   │              │              │  (timer counting down)
   ├──confirm─────▶│              │
   │              ├──cancel timer─▶│
   │              │◀──ack────────┤
   │◀──confirmed──┤              │
```

1. Frontend sends config commands to the API
2. API connects to the device and applies the configuration
3. Sets a revert timer on the device (RouterOS safe mode / scheduler)
4. Returns pending status to the frontend
5. User confirms the change works (e.g., connectivity still up)
6. If confirmed: API cancels the revert timer, config is permanent
7. If timeout or rejected: device automatically reverts to the previous configuration

This pattern prevents lockouts from misconfigured firewall rules or IP changes.

### Authentication (SRP-6a Zero-Knowledge Proof)

```
Browser                     API                   PostgreSQL
   │                          │                       │
   │──register────────────────▶│                      │
   │  (email, salt, verifier) │──store verifier──────▶│
   │                          │                       │
   │──login step 1────────────▶│                      │
   │  (email, client_public)  │──lookup verifier─────▶│
   │◀──(salt, server_public)──┤◀─────────────────────┤
   │                          │                       │
   │──login step 2────────────▶│                      │
   │  (client_proof)          │──verify proof────────│
   │◀──(server_proof, JWT)────┤                      │
```

1. **Registration**: Client derives a verifier from `password + secret_key` using PBKDF2 (650K iterations) + HKDF + XOR (2SKD). Only the salt and verifier are sent to the server -- never the password
2. **Login step 1**: Client sends email and ephemeral public value; server responds with stored salt and its own ephemeral public value
3. **Login step 2**: Client computes a proof from the shared session key; server validates the proof without ever seeing the password
4. **Token issuance**: On successful proof, server issues JWT (15min access + 7d refresh)
5. **Emergency Kit**: A downloadable PDF containing the user's secret key for account recovery

## Multi-Tenancy Model

- Every data table includes a `tenant_id` column
- PostgreSQL RLS policies filter rows by `current_setting('app.current_tenant')`
- The API sets tenant context (`SET app.current_tenant = ...`) on each database session
- `super_admin` role has NULL `tenant_id` and can access all tenants
- `poller_user` bypasses RLS intentionally (needs cross-tenant device access for polling)
- Tenant isolation is enforced at the database level, not the application level -- even a compromised API cannot leak cross-tenant data through `app_user` connections

## Sites & Sectors

The site management subsystem provides hierarchical device organization for tower-based wireless deployments.

- **Sites**: Named geographic locations (towers, POPs, huts) with optional latitude/longitude coordinates
- **Sectors**: Coverage zones within a site, representing individual antenna faces or radio segments. Each sector belongs to exactly one site and can have one or more devices assigned
- **Device assignment**: Devices are assigned to sectors, inheriting site membership. A device belongs to at most one sector at a time
- **Site health**: Aggregate health status is derived from the devices within a site's sectors -- if any device is down, the site status reflects it

## Wireless Link Discovery

MAC-based automatic detection of AP-to-CPE wireless links.

- **Interface subscriber**: Ingests device interface data from NATS, building a MAC-to-device lookup table
- **Wireless registration subscriber**: Processes per-client wireless registration events, capturing connected MACs and signal data
- **Link discovery subscriber**: Correlates AP registration tables with CPE interface MACs to identify links between managed devices
- **State machine**: Each discovered link transitions through states based on signal quality and reachability:
  - `discovered` -- initial detection, not yet confirmed
  - `active` -- confirmed bidirectional link with acceptable signal
  - `degraded` -- signal below threshold or intermittent connectivity
  - `down` -- link lost (device unreachable or deregistered)
  - `stale` -- no update received within the retention window
- **Automatic pairing**: When an AP's registration table contains a MAC belonging to a managed CPE, a link record is created without manual configuration

## Signal History & Trend Detection

Per-client signal strength tracking with automatic degradation alerting.

- **Signal history**: Records signal strength samples for each wireless client over time, stored in TimescaleDB for efficient time-range queries
- **Trend detection loop** (hourly): Analyzes recent signal history to identify sustained degradation. When a client's signal drops below threshold for a configurable window, the system creates a site alert event with rule type `signal_degradation`. Auto-resolves when signal recovers
- **Retention**: Signal history samples are subject to the same retention cleanup as other time-series data

## Site Alert Rules

Geographic-scoped alerting distinct from per-device alerts.

- **Rule types**: Configurable rules scoped to a site (e.g., "alert when more than N devices are down at site X", signal degradation thresholds)
- **Evaluation loop** (5-minute cycle): Evaluates all enabled site alert rules against current data
- **Hysteresis**: Rules require consecutive hits (default 2) before confirming an alert, preventing flapping from transient conditions
- **Event lifecycle**: Alert events are created when rules trigger and auto-resolved when conditions clear. Manual resolution is also supported
- **Separation from device alerts**: Site alerts operate independently from the per-device alert system, allowing operators to set geographic thresholds without duplicating device-level rules

## Security Layers

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Authentication** | SRP-6a | Zero-knowledge proof -- password never transmitted or stored |
| **Key Derivation** | 2SKD (PBKDF2 650K + HKDF + XOR) | Two-secret key derivation from password + secret key |
| **Encryption at Rest** | OpenBao Transit | Envelope encryption for device credentials |
| **Tenant Isolation** | PostgreSQL RLS | Database-level row filtering by tenant_id |
| **Access Control** | JWT + RBAC | Role-based permissions (super_admin, admin, operator, viewer) |
| **Rate Limiting** | Redis-backed | Auth endpoints limited to 5 requests/min |
| **TLS Certificates** | Internal CA | Certificate management and deployment to RouterOS devices |
| **Security Headers** | Middleware | CSP, SRI hashes on JS bundles, X-Frame-Options, etc. |
| **Secret Validation** | Startup check | Rejects known-insecure defaults in non-dev environments |

## Network Topology

All services communicate over a single Docker bridge network (`tod`). External ports:

| Service | Internal Port | External Port | Protocol |
|---------|--------------|---------------|----------|
| Frontend | 80 | 3000 | HTTP |
| API | 8000 | 8001 | HTTP |
| PostgreSQL | 5432 | 5432 | TCP |
| Redis | 6379 | 6379 | TCP |
| NATS | 4222 | 4222 | TCP |
| NATS Monitor | 8222 | 8222 | HTTP |
| OpenBao | 8200 | 8200 | HTTP |
| WireGuard | 51820 | 51820 | UDP |
| Poller SSH Relay | 8080 | 8080 | HTTP/WebSocket |
| Poller WinBox Tunnels | 49000–49100 | 49000–49100 | TCP (localhost only) |

## File Structure

```
backend/                    FastAPI Python backend
  app/
    main.py                 Application entry point, lifespan, router registration
    config.py               Pydantic Settings configuration
    database.py             SQLAlchemy engines (admin + app_user)
    models/                 SQLAlchemy ORM models
    routers/                FastAPI route handlers (33 modules)
    services/               Business logic, NATS subscribers, schedulers
    middleware/              Rate limiting, request ID, security headers
frontend/                   React TypeScript frontend
  src/
    routes/                 TanStack Router file-based routes
    components/             Reusable UI components
    lib/                    API client, crypto, utilities
poller/                     Go microservice for device polling
  main.go                   Entry point
  Dockerfile                Multi-stage build
  internal/
    tunnel/                 WinBox TCP proxy and port pool manager
    sshrelay/               WebSocket-to-SSH bridge for browser terminals
infrastructure/             Deployment configuration
  docker/                   Dockerfiles for api, frontend
  helm/                     Kubernetes Helm charts
  openbao/                  OpenBao init scripts
scripts/                    Database init scripts
docker-compose.yml          Infrastructure services (postgres, redis, nats, openbao, wireguard)
docker-compose.override.yml Application services for dev (api, poller, frontend)
```

## Running the Stack

```bash
# Infrastructure only (postgres, redis, nats, openbao, wireguard)
docker compose up -d

# Full stack including application services (api, poller, frontend)
docker compose --profile full up -d

# Build images sequentially to avoid OOM on low-RAM machines
docker compose build api
docker compose build poller
docker compose build frontend
```

## Container Memory Limits

| Service | Limit |
|---------|-------|
| PostgreSQL | 512MB |
| API | 512MB |
| Go Poller | 512MB |
| OpenBao | 256MB |
| Redis | 128MB |
| NATS | 256MB |
| WireGuard | 128MB |
| Frontend (nginx) | 64MB |
