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
- **OpenBao** -- Secrets management (Transit encryption for credentials, config backups, audit logs)
- **WireGuard** -- VPN gateway for isolated device networks
- **WinBox Worker** -- Xpra-based container for browser WinBox sessions (runs on linux/amd64, 1GB memory limit)

## Prerequisites

- Docker Engine 24+ with Docker Compose v2
- At least 4GB RAM (2GB absolute minimum -- builds are memory-intensive)
- External SSD or fast storage recommended for Docker volumes
- Network access to RouterOS devices on ports 8728 (API) and 8729 (API-SSL)

## Quick Start

### Automated Setup (Recommended)

The setup wizard handles all configuration interactively:

```bash
git clone https://github.com/staack/the-other-dude.git tod
cd tod
python3 setup.py
```

For CI/CD pipelines or headless servers, the wizard supports non-interactive mode:

```bash
python3 setup.py --non-interactive \
    --postgres-password 'MyP@ss!' \
    --domain tod.example.com \
    --admin-email admin@example.com \
    --no-telemetry --yes
```

Available flags: `--non-interactive`, `--postgres-password`, `--admin-email`, `--admin-password`, `--domain`, `--smtp-host`, `--smtp-port`, `--smtp-user`, `--smtp-password`, `--smtp-from`, `--smtp-tls`, `--no-smtp-tls`, `--proxy caddy|nginx|apache|haproxy|traefik|skip`, `--telemetry`, `--no-telemetry`, `--yes`/`-y`. The wizard also handles EOFError gracefully when stdin is not a TTY.

### Manual Setup

If you prefer manual configuration, follow the steps below.

### 1. Clone and Configure

```bash
git clone https://github.com/staack/the-other-dude.git tod
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
# Open http://localhost in a web browser
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

Most state is bind-mounted to the host filesystem under `./docker-data/`. Default locations are configured in `docker-compose.yml`:

- **PostgreSQL data**: `./docker-data/postgres`
- **Redis data**: `./docker-data/redis`
- **NATS data**: `./docker-data/nats`
- **Git store (config backups)**: `./docker-data/git-store`
- **Firmware cache**: `./docker-data/firmware-cache` (downloaded RouterOS firmware packages)

There is one exception, and it matters more than the rest:

- **OpenBao data**: the `openbao_data` **named Docker volume**, not a bind mount

That volume holds the Transit encryption keys. Device credentials, credential
profiles, config backup contents and audit log detail bodies are all stored as
ciphertext that only those keys can open, and the keys cannot be exported
through the Transit API — copying the storage is the only way to back them up.
Because it is a named volume rather than a bind mount, **`docker compose down -v`
and `docker volume prune` both destroy it** while leaving the database and the
git store fully intact on disk and permanently unreadable. See
[Data Loss Failure Modes](#data-loss-failure-modes).

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
| OpenBao | 256MB |
| WireGuard | 128MB |
| WinBox Worker | 1GB |

Adjust under `deploy.resources.limits.memory` in `docker-compose.prod.yml`.

> **Note:** The WinBox tunnel port range (`TUNNEL_PORT_MIN`–`TUNNEL_PORT_MAX`, default 49000–49100) must be mapped in the poller container's port bindings. Add `"49000-49100:49000-49100"` to the poller service's `ports` list in your compose file. The SSH relay port (`SSH_RELAY_PORT`, default 8080) similarly requires a port mapping if accessed directly.

## API Documentation

The backend serves interactive API documentation at:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

All endpoints include descriptions, request/response schemas, and authentication requirements.

## Kubernetes (Helm)

TOD includes a Helm chart for Kubernetes deployment at `infrastructure/helm/`.

### Prerequisites

- Kubernetes 1.28+
- Helm 3
- A StorageClass that supports ReadWriteOnce PersistentVolumeClaims

### Install

1. Create a values override file with your configuration:
   ```bash
   cp infrastructure/helm/values.yaml my-values.yaml
   # Edit my-values.yaml — at minimum set:
   #   secrets.jwtSecretKey, secrets.credentialEncryptionKey,
   #   secrets.dbPassword, secrets.dbAppPassword, secrets.dbPollerPassword,
   #   secrets.firstAdminPassword, ingress.host
   ```

2. Install the chart:
   ```bash
   helm install tod infrastructure/helm -f my-values.yaml -n tod --create-namespace
   ```

3. Initialize OpenBao (first time only):
   ```bash
   # Wait for the pod to start
   kubectl get pods -n tod -l app.kubernetes.io/component=openbao

   # Initialize
   kubectl exec -it -n tod tod-openbao-0 -- bao operator init -key-shares=1 -key-threshold=1

   # Save the unseal key and root token, then unseal
   kubectl exec -it -n tod tod-openbao-0 -- bao operator unseal <UNSEAL_KEY>

   # Update release with the token
   helm upgrade tod infrastructure/helm -f my-values.yaml \
     --set secrets.openbaoToken=<ROOT_TOKEN> \
     --set secrets.baoUnsealKey=<UNSEAL_KEY> \
     -n tod
   ```

4. Verify:
   ```bash
   kubectl get pods -n tod
   kubectl port-forward -n tod svc/tod-api 8000:8000
   curl http://localhost:8000/health
   ```

### Services

The Helm chart deploys:

| Service | Type | Purpose |
|---------|------|---------|
| PostgreSQL (TimescaleDB) | StatefulSet | Primary database |
| Redis | Deployment | Cache |
| NATS JetStream | StatefulSet | Message queue |
| OpenBao | StatefulSet | Secrets management |
| API | Deployment | FastAPI backend |
| Frontend | Deployment | React SPA (nginx) |
| Poller | Deployment | Go device poller |
| WireGuard | Deployment | VPN gateway |
| WinBox Worker | Deployment | Browser-based WinBox sessions (Xpra) |

### Configuration

All configuration is in `values.yaml`. See `infrastructure/helm/values.yaml` for the full reference with comments. Key sections:

- `secrets.*` -- All secrets (must be overridden in production)
- `api.env.*` -- API environment settings
- `poller.env.*` -- Poller settings
- `ingress.*` -- Ingress routing and TLS
- `wireguard.*` -- VPN configuration (can be disabled with `wireguard.enabled: false`)

### Note on OpenBao

OpenBao must be manually unsealed after every pod restart. Auto-unseal is a planned future enhancement.

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
- **Grafana**: `http://localhost:3001` (default: admin/admin — change the default password immediately on any networked host)

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

### Backup and Restore

TOD's data lives in four places. A backup missing any one of them restores a
portal that looks healthy and cannot read its own data:

| What | Where | Lose it and |
|------|-------|-------------|
| Devices, users, license, backup timeline | PostgreSQL | Everything is gone |
| Config backup **contents** | `./docker-data/git-store` | The timeline survives; every backup in it is unopenable. `config_backup_runs` stores only a commit SHA — the export.rsc and backup.bin are not in PostgreSQL |
| Transit encryption keys | `openbao_data` volume | Credentials, config backup bodies and audit details are undecryptable ciphertext |
| `BAO_UNSEAL_KEY`, `CREDENTIAL_ENCRYPTION_KEY` | `.env.prod` (gitignored, in no volume) | The OpenBao data above is a safe with no combination |

Use the supplied scripts rather than a bare `pg_dump`, which captures only the
first row of that table:

```bash
# Take a backup. Refuses rather than producing an archive it knows to be
# unrestorable: aborts if OpenBao is sealed or unreachable, if BAO_UNSEAL_KEY
# is missing, or if the database records config backups whose git store is not
# there. Stops OpenBao briefly for a consistent copy of the key store.
./scripts/backup.sh

# Restore. Ends by Transit-decrypting a real device credential and a real
# config backup body, and fails loudly if either cannot be read, rather than
# reporting success on a restore that silently cannot decrypt anything.
./scripts/restore.sh backups/tod-backup-YYYYmmdd-HHMMSS.tar.gz
```

The archive contains your unseal key and credential encryption key in
cleartext. Anyone holding it can decrypt every device credential and config
backup in it. Store it encrypted and off this host.

Two notes on what is not in the archive:

- **WireGuard's `wg0.conf`** is derived state, not backed up. The API
  regenerates it from the database on every startup, so bringing the stack up
  after a restore completes it. Before v10 that regeneration only happened when
  a tenant's VPN settings were saved, so a restore onto a fresh host produced a
  correct device inventory and a dead VPN with nothing to explain why.
- **Redis contents** are not backed up at all. See below for what that costs.

### Data Loss Failure Modes

These lose data. They are listed here so an operator reads them rather than
discovers them.

| Failure | Effect | Prevention |
|---------|--------|------------|
| `docker compose down -v` | Destroys `openbao_data`. Every credential, config backup body and audit detail becomes permanently undecryptable — while the database and git store survive intact, so nothing looks broken until a device fails to poll. On the next start OpenBao initialises a **fresh** key set and the API begins returning 403s against the old token, which reads as a permissions problem rather than as data loss | Never use `-v` on a production stack. Take a backup first |
| `docker volume prune` while the stack is down | Identical to the above, from a command whose purpose is to be safe | As above |
| Losing `.env.prod` | OpenBao can never be unsealed again; the Transit keys are unrecoverable even with a perfect volume backup | `backup.sh` includes it. Store the archive off-host |
| Backing up PostgreSQL only | Loses 100% of config backup contents, silently — the UI still lists every run | Use `backup.sh` |
| Redis loss or wipe | Redis runs with stock settings: RDB snapshots, no AOF, so a crash loses the most recent writes. WinBox session registry, the recent-push tracker that drives rollback, and alert flap-detection windows are all Redis-only and are all rebuildable. **The JWT revocation list is not**: wiping Redis makes every revoked refresh token valid again for up to 7 days | Rotate `JWT_SECRET_KEY` after any unplanned Redis loss |
| NATS JetStream retention | `DEVICE_EVENTS` is capped at 24h / 64MB with `DiscardOld`. An API outage that outlasts the backlog silently drops the oldest events while the poller reports success throughout. At roughly 20 devices, 64MB is on the order of ten hours | Restore API service within the retention window; raise `MaxBytes` for larger fleets |
| Host disk loss | Everything, including `.env.prod` | Off-host backups |

Gaps caused by the poller failing to deliver data — a NATS outage, a PostgreSQL
outage, or the poller process dying — are **recorded** in the `ingest_gaps`
table rather than silently absent. TOD does not attempt to recover the lost
samples; it records that they are missing, with the interval and the reason.

### Restart and Recovery Behaviour

Every production service carries `restart: unless-stopped`, so the stack is
configured to return on its own after a host reboot or a Docker daemon restart.
A plain restart (`docker compose restart`, or `down` without `-v` followed by
`up -d`) is not expected to lose committed data: devices, credentials, config
snapshots and license state are all on disk.

**Measured recovery time: 17 seconds.** Timed on a 10-container single-node
install by restarting the Docker daemon, which is what a host reboot does to
the stack:

| | |
|---|---|
| Docker daemon responsive | +16s |
| All containers running | +16s |
| API `/health/ready` returning 200 | **+17s** |

One case is much slower. If the NATS JetStream streams do not yet exist — a
genuine first boot, or a start after `./docker-data/nats` has been lost — the
API takes around **220 seconds** to begin serving. Roughly seven NATS
subscribers each retry the missing stream six times at five-second intervals,
sequentially, before giving up, and that happens during application startup
before the API accepts any request. The streams are created by the poller, so
this resolves itself once the poller has run; on an ordinary reboot the streams
are already on disk and the 17-second figure applies.

Before v10 the stack did not come back at all. `postgres` and `redis` carried
no restart policy, so a daemon restart left them stopped along with everything
that depends on them, and the API never returned. If you are running an older
compose file, add `restart: unless-stopped` to both.

`restart: on-failure` is **not** sufficient here, which is easy to get wrong. A
daemon restart stops containers cleanly, so they exit 0, and `on-failure` only
restarts a container that exited non-zero. Measured on the same host: with
`on-failure`, postgres, redis, NATS, the API and the frontend all stayed down
after a daemon restart. `unless-stopped` is the policy that returns.

The poller reconnects to both NATS and PostgreSQL without intervention —
unlimited reconnects with a 2s backoff for NATS, and a connection pool that
re-dials PostgreSQL. Any interval during which it could not deliver what it
collected is written to `ingest_gaps`, including the window it was not running
at all, which it reconstructs on startup from the last heartbeat it wrote.

`/health/ready` on the API and `/healthz` on the poller both report real
dependency state and return 503 when PostgreSQL, Redis or NATS is unreachable.
Neither returns a fixed value.

### Updating

```bash
# Back up before upgrading -- see Backup and Restore above
./scripts/backup.sh

git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build api
docker compose -f docker-compose.yml -f docker-compose.prod.yml build poller
docker compose -f docker-compose.yml -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

Database migrations run automatically on API startup via Alembic.

### WinBox Binary Updates

The WinBox binary used by the WinBox Worker is downloaded and checksum-verified **at image build time only** -- never at runtime. Its version and expected SHA256 are pinned as build args in `winbox-worker/Dockerfile`:

```dockerfile
ARG WINBOX_VERSION=4.0.1
ARG WINBOX_SHA256=8ec2d08929fd434c4b88881f3354bdf60b057ecd2fb54961dd912df57e326a70
```

`docker build` downloads `https://download.mikrotik.com/routeros/winbox/${WINBOX_VERSION}/WinBox_Linux.zip` and runs `sha256sum -c` against the pinned hash before unzipping it into the image -- the build fails outright if the archive doesn't match. Nothing the worker container does at runtime touches the network for this; the binary that ships in the image is exactly the one that was built and scanned.

**Automated updates.** `.github/workflows/winbox-version-check.yml` runs weekly (and on manual `workflow_dispatch`). It renders MikroTik's download page (`mikrotik.com/download/winbox` -- there is no version API or feed; MikroTik does not publish one, so this is real browser automation, not a JSON lookup), and if a newer release exists:

1. Downloads that release's `WinBox_Linux.zip.sha256` (MikroTik publishes one alongside every download) and the archive itself, and verifies the archive matches the published checksum -- entirely independent of anything the Dockerfile does. A checksum mismatch aborts the run; no PR is opened for an archive this job couldn't verify itself.
2. Bumps `WINBOX_VERSION` / `WINBOX_SHA256` in `winbox-worker/Dockerfile` and opens a pull request.

**This PR does not merge itself.** It goes through the normal `ci.yml` pipeline like any other change: the `build` job builds the `winbox-worker` image with the new pin (which independently re-verifies the checksum via the Dockerfile's own `sha256sum -c`) and then runs `winbox-worker/scripts/smoke_test.sh` against the built image, which starts a real WinBox session and confirms the WinBox process is actually running inside the container -- not just that the image built. A version bump that breaks session startup fails that step and blocks the merge. A human still reviews and merges the PR.

**Pinning a version by hand.** If you don't trust the automated pipeline, or want to hold back a release, disable or ignore `winbox-version-check.yml` and edit the two `ARG` lines in `winbox-worker/Dockerfile` yourself. To get the checksum for any WinBox release without running the pipeline:

```bash
curl -fsSL "https://download.mikrotik.com/routeros/winbox/<version>/WinBox_Linux.zip.sha256"
```

That prints a single `<sha256>  WinBox_Linux.zip` line straight from MikroTik -- paste the hash into `WINBOX_SHA256` and the version into `WINBOX_VERSION`, then rebuild the `winbox-worker` image. The Dockerfile's own build-time verification catches a typo or a stale hash either way.

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
