# Configuration Reference

TOD uses Pydantic Settings for configuration. All values can be set via environment variables or an env file. In Docker Compose deployments, environment variables are loaded from `.env.prod` in the project root via `--env-file`. For local development without Docker, the backend also reads `backend/.env`.

## Environment Variables

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | `TOD - The Other Dude` | Application display name |
| `APP_VERSION` | `0.1.0` | Semantic version string |
| `ENVIRONMENT` | `dev` | Runtime environment: `dev`, `staging`, or `production` |
| `DEBUG` | `false` | Enable debug mode |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173,http://localhost:8080` | Comma-separated list of allowed CORS origins |
| `APP_BASE_URL` | `http://localhost:3000` | Frontend base URL (used in password reset emails) |

### Authentication & JWT

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET_KEY` | *(insecure dev default)* | HMAC signing key for JWTs. **Must be changed in production.** Generate with: `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime in minutes |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime in days |
| `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES` | `30` | Password reset link validity in minutes |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/mikrotik` | Admin (superuser) async database URL. Used for migrations and bootstrap operations. |
| `SYNC_DATABASE_URL` | `postgresql+psycopg2://postgres:postgres@localhost:5432/mikrotik` | Synchronous database URL used by Alembic migrations only. |
| `APP_USER_DATABASE_URL` | `postgresql+asyncpg://app_user:app_password@localhost:5432/mikrotik` | Non-superuser async database URL. Enforces PostgreSQL RLS for tenant isolation. |
| `DB_POOL_SIZE` | `20` | App user connection pool size |
| `DB_MAX_OVERFLOW` | `40` | App user pool max overflow connections |
| `DB_ADMIN_POOL_SIZE` | `10` | Admin connection pool size |
| `DB_ADMIN_MAX_OVERFLOW` | `20` | Admin pool max overflow connections |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `CREDENTIAL_ENCRYPTION_KEY` | *(insecure dev default)* | AES-256-GCM encryption key for device credentials at rest. Must be exactly 32 bytes, base64-encoded. **Must be changed in production.** Generate with: `python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"` |

### OpenBao / Vault (KMS)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENBAO_ADDR` | `http://localhost:8200` | OpenBao Transit server address for per-tenant envelope encryption |
| `OPENBAO_TOKEN` | *(insecure dev default)* | OpenBao authentication token. **Must be changed in production.** |

OpenBao is the key management service used to encrypt device credentials on a per-tenant basis. In Docker deployments, it runs as a container alongside the other services.

### NATS

| Variable | Default | Description |
|----------|---------|-------------|
| `NATS_URL` | `nats://localhost:4222` | NATS JetStream server URL for pub/sub between Go poller and Python API |

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis URL for caching, distributed locks, and rate limiting |

### SMTP (Notifications)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | `localhost` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | *(none)* | SMTP authentication username |
| `SMTP_PASSWORD` | *(none)* | SMTP authentication password |
| `SMTP_USE_TLS` | `false` | Enable STARTTLS for SMTP connections. If using port 587 (STARTTLS), set `SMTP_USE_TLS=true`. |
| `SMTP_FROM_ADDRESS` | `noreply@the-other-dude.local` | Sender address for outbound emails |

### Firmware

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRMWARE_CACHE_DIR` | `/data/firmware-cache` | Path to firmware download cache (PVC mount in production) |
| `FIRMWARE_CHECK_INTERVAL_HOURS` | `24` | Hours between automatic RouterOS version checks |

### Storage Paths

| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_STORE_PATH` | `./git-store` | Path to bare git repos for config backup history (one repo per tenant). In production: `/data/git-store` on a ReadWriteMany PVC. |
| `WIREGUARD_CONFIG_PATH` | `/data/wireguard` | Shared volume path for WireGuard configuration files |

### Remote Access (Go Poller)

| Variable | Default | Description |
|----------|---------|-------------|
| `TUNNEL_PORT_MIN` | `49000` | Start of WinBox tunnel port range |
| `TUNNEL_PORT_MAX` | `49100` | End of WinBox tunnel port range |
| `TUNNEL_IDLE_TIMEOUT` | `300` | WinBox tunnel idle timeout (seconds) |
| `SSH_RELAY_PORT` | `8080` | SSH relay HTTP server port |
| `SSH_IDLE_TIMEOUT` | `900` | SSH session idle timeout (seconds) |
| `SSH_MAX_SESSIONS` | `200` | Maximum concurrent SSH sessions |
| `SSH_MAX_PER_USER` | `10` | Maximum SSH sessions per user |
| `SSH_MAX_PER_DEVICE` | `20` | Maximum SSH sessions per device |

### Bootstrap

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRST_ADMIN_EMAIL` | *(none)* | Email for the initial super_admin user. Only used if no users exist in the database. |
| `FIRST_ADMIN_PASSWORD` | *(none)* | Password for the initial super_admin user. On first login, you will be guided through a one-time security enrollment to set up zero-knowledge credentials. |

## Production Safety

TOD refuses to start in `staging` or `production` environments if any of these variables still have their insecure dev defaults:

- `JWT_SECRET_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `OPENBAO_TOKEN`

The process exits with code 1 and a clear error message indicating which variable needs to be rotated.

## Docker Compose Profiles

| Profile | Command | Services |
|---------|---------|----------|
| *(default)* | `docker compose up -d` | Infrastructure only: PostgreSQL, Redis, NATS, OpenBao |
| `full` | `docker compose --profile full up -d` | All services: infrastructure + API, Poller, Frontend |

## Container Memory Limits

All containers have enforced memory limits to prevent OOM on the host:

| Service | Memory Limit |
|---------|-------------|
| PostgreSQL | 512 MB |
| Redis | 128 MB |
| NATS | 128 MB |
| API | 512 MB |
| Poller | 256 MB |
| Frontend | 64 MB |

Build Docker images sequentially (not in parallel) to avoid OOM during builds.
