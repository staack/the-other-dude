# Technology Stack

**Analysis Date:** 2026-03-12

## Languages

**Primary:**
- Python 3.12+ - Backend API (`/backend`)
- Go 1.24.0 - Poller service (`/poller`)
- TypeScript 5.9.3 - Frontend (`/frontend`)
- JavaScript - Frontend runtime

**Secondary:**
- SQL - PostgreSQL database queries and migrations
- YAML - Docker Compose configuration
- Shell - Infrastructure scripts

## Runtime

**Environment:**
- Node.js runtime (frontend)
- Python 3.12+ runtime (backend)
- Go 1.24.0 runtime (poller)

**Package Manager:**
- npm (Node.js) - Frontend dependencies
- pip/hatchling (Python) - Backend dependencies
- go mod (Go) - Poller dependencies

## Frameworks

**Core:**
- FastAPI 0.115.0+ - Backend REST API (`app/main.py`)
- React 19.2.0 - Frontend UI components
- TanStack React Router 1.161.3 - Frontend routing and navigation
- TanStack React Query 5.90.21 - Frontend data fetching and caching
- Vite 7.3.1 - Frontend build tool and dev server
- go-routeros/v3 - MikroTik RouterOS binary protocol client

**Testing:**
- pytest 8.0.0+ - Backend unit/integration tests (`tests/`)
- vitest 4.0.18 - Frontend unit tests
- @playwright/test 1.58.2 - Frontend E2E tests
- testcontainers-go 0.40.0 - Go integration tests with Docker containers

**Build/Dev:**
- TypeScript 5.9.3 - Frontend type checking via `tsc -b`
- ESLint 9.39.1 - Frontend linting
- Alembic 1.14.0 - Backend database migrations
- docker compose - Multi-service orchestration
- pytest-cov 5.0.0 - Backend test coverage reporting
- vitest coverage - Frontend test coverage

## Key Dependencies

**Critical:**
- SQLAlchemy 2.0+ (asyncio) - Backend ORM with async support (`app/database.py`)
- asyncpg 0.30.0+ - Async PostgreSQL driver for Python
- pgx/v5 - Sync PostgreSQL driver for Go poller
- nats-py 2.7.0+ - NATS JetStream client (Python, event publishing)
- nats.go 1.38.0+ - NATS JetStream client (Go, event publishing and subscribing)
- redis (Python 5.0.0+) - Redis async client for session storage (`app/routers/auth.py`)
- redis/go-redis/v9 - Redis client for Go (distributed locks)
- httpx 0.27.0+ - Async HTTP client for OpenBao API calls
- asyncssh 2.20.0+ - SSH library for remote device access

**Infrastructure:**
- cryptography 42.0.0+ - Encryption/decryption, SSH key handling
- bcrypt 4.0.0-5.0.0 - Password hashing
- python-jose 3.3.0+ - JWT token creation and validation
- pydantic 2.0.0+ - Request/response validation, settings
- pydantic-settings 2.0.0+ - Environment variable configuration
- slowapi 0.1.9+ - Rate limiting middleware
- structlog 25.1.0+ - Structured logging
- prometheus-fastapi-instrumentator 7.0.0+ - Prometheus metrics export
- aiosmtplib 3.0.0+ - Async SMTP for email notifications
- weasyprint 62.0+ - PDF report generation
- pygit2 1.14.0+ - Git version control integration (`app/services/git_store.py`)
- apscheduler 3.10.0-4.0 - Background job scheduling

**Frontend UI:**
- @radix-ui/* (v1-2) - Accessible component primitives
- Tailwind CSS 3.4.19 - Utility-first CSS framework
- lucide-react 0.575.0 - Icon library
- framer-motion 12.34.3 - Animation library
- recharts 3.7.0 - Chart library
- reactflow 11.11.4 - Network diagram rendering
- react-leaflet 5.0.0 - Map visualization
- xterm.js 6.0.0 - Terminal emulator for SSH (`@xterm/xterm`, `@xterm/addon-fit`)
- sonner 2.0.7 - Toast notifications
- zod 4.3.6 - Runtime schema validation
- zustand 5.0.11 - Lightweight state management
- axios 1.13.5 - HTTP client for API calls
- diff 8.0.3 - Diff computation for git-diff-view

**Testing Libraries:**
- @testing-library/react 16.3.2 - React component testing utilities
- @testing-library/user-event 14.6.1 - User interaction simulation
- jsdom 28.1.0 - DOM implementation for Node.js tests

## Configuration

**Environment:**
- `.env` file (Pydantic BaseSettings) - Development environment variables
- `.env.example` - Template with safe defaults
- `.env.staging.example` - Staging environment template
- Environment validation in `app/config.py` - Rejects known-insecure defaults in non-dev environments

**Key Environment Variables:**
- `ENVIRONMENT` - (dev|staging|production)
- `DATABASE_URL` - PostgreSQL async connection (admin role)
- `SYNC_DATABASE_URL` - PostgreSQL sync for Alembic migrations
- `APP_USER_DATABASE_URL` - PostgreSQL with app_user role (RLS enforced)
- `POLLER_DATABASE_URL` - PostgreSQL for Go poller (separate role)
- `REDIS_URL` - Redis connection for sessions and locks
- `NATS_URL` - NATS JetStream connection
- `JWT_SECRET_KEY` - HS256 signing key (must be unique in production)
- `CREDENTIAL_ENCRYPTION_KEY` - Base64-encoded 32-byte AES key for credential storage
- `OPENBAO_ADDR` - OpenBao HTTP endpoint
- `OPENBAO_TOKEN` - OpenBao auth token
- `CORS_ORIGINS` - Comma-separated allowed frontend origins
- `SMTP_HOST`, `SMTP_PORT` - Email configuration

**Build:**
- `vite.config.ts` - Vite bundler configuration (frontend)
- `tsconfig.json` - TypeScript compiler options
- `pyproject.toml` - Python project metadata and dependencies
- `go.mod` / `go.sum` - Go module dependencies
- `Dockerfile` - Multi-stage builds for all three services
- `docker-compose.yml` - Local development stack

## Platform Requirements

**Development:**
- Python 3.12+
- Node.js 18+ (npm)
- Go 1.24.0
- Docker and Docker Compose
- PostgreSQL 17 (via Docker)
- Redis 7 (via Docker)
- NATS 2+ with JetStream (via Docker)
- OpenBao 2.1+ (via Docker)
- WireGuard (via Docker image)

**Production:**
- Kubernetes or Docker Swarm for orchestration
- PostgreSQL 17+ with TimescaleDB extension
- Redis 7+ (standalone or cluster)
- NATS 2.0+ with JetStream persistence
- OpenBao 2.0+ for encryption key management
- WireGuard container for VPN tunneling
- TLS certificates for HTTPS (Caddy/nginx reverse proxy)
- Storage for git-backed configs (`/data/git-store` - ReadWriteMany PVC)
- Storage for firmware cache (`/data/firmware-cache`)

---

*Stack analysis: 2026-03-12*
