# TOD - The Other Dude — Deployment Guide

## Overview

TOD (The Other Dude) is a containerized fleet management platform for RouterOS devices. This guide covers Docker Compose deployment for production environments.

### Architecture

- **Backend API** (Python/FastAPI) -- REST API with JWT authentication and PostgreSQL RLS
- **Go Poller** -- Polls RouterOS devices via binary API, publishes events to NATS
- **Frontend** (React/nginx) -- Single-page application served by nginx (dynamic DNS resolver prevents 502 errors after API container restarts)
- **PostgreSQL + TimescaleDB** -- Primary database with time-series extensions
- **Redis** -- Distributed locking and rate limiting
- **NATS JetStream** -- Message bus for device events

## Prerequisites

- Docker Engine 24+ with Docker Compose v2
- At least 4GB RAM (2GB absolute minimum -- builds are memory-intensive)
- External SSD or fast storage recommended for Docker volumes
- Network access to RouterOS devices on ports 8728 (API) and 8729 (API-SSL)

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url> tod
cd tod

# Copy environment template
cp .env.example .env.prod
```

### 2. Generate Secrets

```bash
# Generate JWT secret
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# Generate credential encryption key (32 bytes, base64-encoded)
python3 -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Edit `.env.prod` with the generated values:

```env
ENVIRONMENT=production
JWT_SECRET_KEY=<generated-jwt-secret>
CREDENTIAL_ENCRYPTION_KEY=<generated-encryption-key>
POSTGRES_PASSWORD=<strong-password>

# First admin user (created on first startup)
FIRST_ADMIN_EMAIL=admin@example.com
FIRST_ADMIN_PASSWORD=<strong-password>
```

### 3. Build Images

Build images **one at a time** to avoid out-of-memory crashes on constrained hosts:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build api
docker compose -f docker-compose.yml -f docker-compose.prod.yml build poller
docker compose -f docker-compose.yml -f docker-compose.prod.yml build frontend
```

### 4. Start the Stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 5. Verify

```bash
# Check all services are running
docker compose ps

# Check API health (liveness)
curl http://localhost:8000/health

# Check readiness (PostgreSQL, Redis, NATS connected)
curl http://localhost:8000/health/ready

# Access the portal
open http://localhost
```

Log in with the `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` credentials set in step 2.

## Environment Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ENVIRONMENT` | Deployment environment | `production` |
| `JWT_SECRET_KEY` | JWT signing secret (min 32 chars) | `<generated>` |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256 key for device credentials (base64) | `<generated>` |
| `POSTGRES_PASSWORD` | PostgreSQL superuser password | `<strong-password>` |
| `FIRST_ADMIN_EMAIL` | Initial admin account email | `admin@example.com` |
| `FIRST_ADMIN_PASSWORD` | Initial admin account password | `<strong-password>` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GUNICORN_WORKERS` | `2` | API worker process count |
| `DB_POOL_SIZE` | `20` | App database connection pool size |
| `DB_MAX_OVERFLOW` | `40` | Max overflow connections above pool |
| `DB_ADMIN_POOL_SIZE` | `10` | Admin database connection pool size |
| `DB_ADMIN_MAX_OVERFLOW` | `20` | Admin max overflow connections |
| `POLL_INTERVAL_SECONDS` | `60` | Device polling interval |
| `CONNECTION_TIMEOUT_SECONDS` | `10` | RouterOS connection timeout |
| `COMMAND_TIMEOUT_SECONDS` | `30` | RouterOS per-command timeout |
| `CIRCUIT_BREAKER_MAX_FAILURES` | `5` | Consecutive failures before backoff |
| `CIRCUIT_BREAKER_BASE_BACKOFF_SECONDS` | `30` | Initial backoff duration |
| `CIRCUIT_BREAKER_MAX_BACKOFF_SECONDS` | `900` | Maximum backoff (15 min) |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`/`info`/`warn`/`error`) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `TUNNEL_PORT_MIN` | `49000` | Start of WinBox tunnel port range |
| `TUNNEL_PORT_MAX` | `49100` | End of WinBox tunnel port range |
| `TUNNEL_IDLE_TIMEOUT` | `300` | WinBox tunnel idle timeout (seconds) |
| `SSH_RELAY_PORT` | `8080` | SSH relay HTTP server port |
| `SSH_IDLE_TIMEOUT` | `900` | SSH session idle timeout (seconds) |
| `SSH_MAX_SESSIONS` | `200` | Maximum concurrent SSH sessions |
| `SSH_MAX_PER_USER` | `10` | Maximum SSH sessions per user |
| `SSH_MAX_PER_DEVICE` | `20` | Maximum SSH sessions per device |

### Security Notes

- **Never use default secrets in production.** The application refuses to start if it detects known insecure defaults (like the dev JWT secret) in non-dev environments.
- **Credential encryption key** is used to encrypt RouterOS device passwords at rest. Losing this key means re-entering all device credentials.
- **CORS_ORIGINS** should be set to your actual domain in production.
- **RLS enforcement**: The app_user database role enforces row-level security. Tenants cannot access each other's data even with a compromised JWT.

## Storage Configuration

Docker volumes mount to the host filesystem. Default locations are configured in `docker-compose.yml`:

- **PostgreSQL data**: `./docker-data/postgres`
- **Redis data**: `./docker-data/redis`
- **NATS data**: `./docker-data/nats`
- **Git store (config backups)**: `./docker-data/git-store`
- **Firmware cache**: `./docker-data/firmware-cache` (downloaded RouterOS firmware packages)

To change storage locations, edit the volume mounts in `docker-compose.yml`.

## Resource Limits

Container memory limits are enforced in `docker-compose.prod.yml` to prevent OOM crashes:

| Service | Memory Limit |
|---------|-------------|
| PostgreSQL | 512MB |
| Redis | 128MB |
| NATS | 128MB |
| API | 512MB |
| Poller | 512MB |
| Frontend | 64MB |

Adjust under `deploy.resources.limits.memory` in `docker-compose.prod.yml`.

> **Note:** The WinBox tunnel port range (`TUNNEL_PORT_MIN`–`TUNNEL_PORT_MAX`, default 49000–49100) must be mapped in the poller container's port bindings. Add `"49000-49100:49000-49100"` to the poller service's `ports` list in your compose file. The SSH relay port (`SSH_RELAY_PORT`, default 8080) similarly requires a port mapping if accessed directly.

## API Documentation

The backend serves interactive API documentation at:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

All endpoints include descriptions, request/response schemas, and authentication requirements.

## Monitoring (Optional)

Enable Prometheus and Grafana monitoring with the observability compose overlay:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.observability.yml \
  --env-file .env.prod up -d
```

- **Prometheus**: `http://localhost:9090`
- **Grafana**: `http://localhost:3001` (default: admin/admin)

### Exported Metrics

The API and poller export Prometheus metrics:

| Metric | Source | Description |
|--------|--------|-------------|
| `http_requests_total` | API | HTTP request count by method, path, status |
| `http_request_duration_seconds` | API | Request latency histogram |
| `mikrotik_poll_total` | Poller | Poll cycles by status (success/error/skipped) |
| `mikrotik_poll_duration_seconds` | Poller | Poll cycle duration histogram |
| `mikrotik_devices_active` | Poller | Number of devices being polled |
| `mikrotik_circuit_breaker_skips_total` | Poller | Polls skipped due to backoff |
| `mikrotik_nats_publish_total` | Poller | NATS publishes by subject and status |

## Maintenance

### Backup Strategy

- **Database**: Use `pg_dump` or configure PostgreSQL streaming replication
- **Config backups**: Git repositories in the git-store volume (automatic nightly backups)
- **Encryption key**: Store `CREDENTIAL_ENCRYPTION_KEY` securely -- required to decrypt device credentials

### Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build api
docker compose -f docker-compose.yml -f docker-compose.prod.yml build poller
docker compose -f docker-compose.yml -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

Database migrations run automatically on API startup via Alembic.

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api

# Filter structured JSON logs with jq
docker compose logs api --no-log-prefix 2>&1 | jq 'select(.event != null)'

# View audit logs (config editor operations)
docker compose logs api --no-log-prefix 2>&1 | jq 'select(.event | startswith("routeros_"))'
```

### Graceful Shutdown

All services handle SIGTERM for graceful shutdown:

- **API (gunicorn)**: Finishes in-flight requests within `GUNICORN_GRACEFUL_TIMEOUT` (default 30s), then disposes database connection pools
- **Poller (Go)**: Cancels all device polling goroutines via context propagation, waits for in-flight polls to complete
- **Frontend (nginx)**: Stops accepting new connections and finishes serving active requests

```bash
# Graceful stop (sends SIGTERM, waits 30s)
docker compose stop

# Restart a single service
docker compose restart api
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| API won't start with secret error | Generate production secrets (see step 2 above) |
| Build crashes with OOM | Build images one at a time (see step 3 above) |
| Device shows offline | Check network access to device API port (8728/8729) |
| Health check fails | Check `docker compose logs api` for startup errors |
| Rate limited (429) | Wait 60 seconds or check Redis connectivity |
| Migration fails | Check `docker compose logs api` for Alembic errors |
| NATS subscriber won't start | Non-fatal -- API runs without NATS; check NATS container health |
| Poller circuit breaker active | Device unreachable; check `CIRCUIT_BREAKER_*` env vars to tune backoff |
| Frontend returns 502 after API restart | nginx caches upstream DNS at startup; the dynamic resolver (`resolver 127.0.0.11`) in `nginx-spa.conf` handles this automatically — if you see 502s, ensure the nginx config has not been overridden |
