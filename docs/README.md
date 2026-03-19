# The Other Dude

**Fleet management platform for MikroTik RouterOS.**

Monitor routers, detect configuration drift, manage backups, and safely push configuration changes across hundreds of devices. Built for MSPs (Managed Service Providers) and network engineers managing MikroTik fleets.

The Other Dude is a self-hosted, multi-tenant platform (one installation serves multiple organizations, each with fully isolated data) that gives you centralized visibility, configuration management, real-time monitoring, and zero-knowledge security across your entire MikroTik fleet -- from a single pane of glass.

---

## Features

### Highlights

- **Router Fleet Monitoring** -- Real-time CPU, memory, disk, traffic, and wireless metrics across every device. Configurable alerts with email, Slack, and webhook notifications.
- **Configuration Drift Detection** -- Automated config snapshots with full version history and side-by-side diffs. Know when configs change and what changed.
- **Safe Configuration Pushes** -- Two-phase config push with automatic panic-revert. Push confidently to remote devices without risking lockouts.
- **Backup Management** -- Automated configuration backups on a schedule. One-click restore to any previous version.
- **Network Topology Visibility** -- Interactive topology map showing device interconnections and shared subnets.

---

### Fleet

- **Dashboard** -- At-a-glance fleet health with device counts, uptime sparklines, status breakdowns per organization, and an "APs Needing Attention" card highlighting wireless issues.
- **Device Management** -- Detailed device pages with system info, interfaces, routes, firewall rules, DHCP leases, and real-time resource metrics.
- **Fleet Table** -- Virtual-scrolled table that handles hundreds of devices without breaking a sweat.
- **Device Map** -- Geographic view of device locations.
- **Subnet Scanner** -- Discover new RouterOS devices on your network and onboard them in clicks.

### Configuration

- **Config Editor** -- Browse and edit RouterOS configuration sections with a structured command interface. Two-phase config push with automatic panic-revert ensures you never brick a remote device.
- **Batch Config** -- Apply configuration changes across multiple devices simultaneously with template support.
- **Bulk Commands** -- Execute arbitrary RouterOS commands across device groups.
- **Templates** -- Reusable configuration templates with variable substitution.
- **Simple Config** -- A Linksys/Ubiquiti-style simplified interface covering Internet, LAN/DHCP, WiFi, Port Forwarding, Firewall, DNS, and System settings. No RouterOS CLI knowledge required.
- **Config Backup & Diff** -- Git-backed configuration storage with full version history and side-by-side diffs. Restore any previous configuration with one click.

### Monitoring

- **Network Topology** -- Interactive topology map showing device interconnections and shared subnets.
- **Real-Time Metrics** -- Live CPU, memory, disk, interface traffic, and wireless stats (client count, signal strength, CCQ (Client Connection Quality)) streamed in real time.
- **Alert Rules** -- Configurable threshold-based alerts for any metric (CPU > 90%, signal < -75 dBm, CCQ < 60%, interface down, uptime reset, etc.). Default wireless alert rules are seeded automatically for new tenants.
- **Notification Channels** -- Route alerts to email, webhooks, or Slack.
- **Audit Trail** -- Immutable log of every action taken in the portal, with user attribution and exportable records.
- **Transparency Dashboard** -- KMS (Key Management Service) access event monitoring for tenant admins (who accessed what encryption keys, when).
- **Reports** -- Generate PDF reports (fleet summary, device detail, security audit, performance) with Jinja2 + WeasyPrint.

### Security

- **Zero-Knowledge Architecture** -- 1Password-style hybrid design. SRP-6a authentication — your password never leaves your browser. Two-secret key derivation ensures neither a stolen password nor a compromised database alone can expose your account.
- **Secret Key** -- A unique Secret Key (format `A3-XXXXXX`) generated at enrollment. Export it as an Emergency Kit PDF — you need it to log in from new devices.
- **OpenBao KMS** -- Per-tenant envelope encryption via Transit secret engine.
- **Internal Certificate Authority** -- Issue and deploy TLS certificates to RouterOS devices via SFTP. Automatic TLS fallback for devices that haven't yet been issued a certificate.
- **WireGuard VPN** -- Manage WireGuard tunnels for secure device access across NAT boundaries.
- **Credential Encryption** -- AES-256-GCM (Fernet) encryption of all stored device credentials at rest.
- **RBAC** (Role-Based Access Control) -- Four roles: `super_admin`, `admin`, `operator`, `viewer`. Database-level tenant isolation ensures one organization's data cannot bleed into another's.

### Administration

- **Multi-Tenancy** -- Full organization isolation with PostgreSQL RLS. Super admins manage all tenants; tenant admins see only their own devices and users.
- **User Management** -- Per-tenant user administration with role assignment.
- **API Keys** -- Generate API keys (prefixed `mktp_`) for automation and integrations. Keys are shown only once at creation.
- **Firmware Management** -- Track RouterOS versions across your fleet, plan upgrades, and push firmware updates.
- **Maintenance Windows** -- Schedule maintenance periods with automatic alert suppression.
- **Setup Wizard** -- Guided 3-step onboarding for first-time deployment.

### UX

- **Command Palette** -- `Cmd+K` / `Ctrl+K` quick navigation (cmdk).
- **Keyboard Shortcuts** -- Vim-style sequence shortcuts (`g d` for dashboard, `g t` for topology, `[` to toggle sidebar).
- **Dark / Light Mode** -- Class-based theming with flicker-free initialization.
- **Page Transitions** -- Smooth route transitions with Framer Motion.
- **Skeleton Loaders** -- Shimmer-gradient loading states throughout the UI.

---

## Architecture

```
                         +-----------+
                         |  Frontend |
                         | React/nginx|
                         +-----+-----+
                               |
                          /api/ proxy
                               |
                         +-----v-----+
                         |    API    |
                         |  FastAPI  |
                         +--+--+--+--+
                            |  |  |
              +-------------+  |  +--------------+
              |                |                 |
        +-----v------+  +-----v-----+   +-------v-------+
        | PostgreSQL  |  |   Redis   |   |     NATS      |
        | TimescaleDB |  |  (locks,  |   |  JetStream    |
        |   (RLS)     |  |  caching) |   |  (pub/sub)    |
        +-----^------+  +-----^-----+   +-------^-------+
              |                |                 |
        +-----+-------+-------+---------+-------+
        |             Poller (Go)                |
        |  Polls RouterOS devices via binary API |
        |        port 8729 TLS                   |
        +----------------------------------------+
              |
     +--------v---------+
     |  RouterOS Fleet   |
     |  (your devices)   |
     +-------------------+
```

- **Frontend** serves the React SPA via nginx and proxies `/api/` to the backend.
- **API** handles all business logic, authentication, and database access with RLS-enforced tenant isolation.
- **Poller** is a Go microservice that polls RouterOS devices on a configurable interval using the RouterOS binary API, publishing results to NATS and persisting to PostgreSQL.
- **PostgreSQL + TimescaleDB** stores all relational data with hypertables for time-series metrics (efficient timestamped data storage).
- **Redis** provides distributed locks (one poller per device) and rate limiting.
- **NATS JetStream** delivers real-time events from the poller to the API and browser.
- **OpenBao** provides Transit secret engine for per-tenant envelope encryption (each organization's data encrypted under its own key).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TanStack Router + Query, Tailwind CSS 3.4, Vite, Framer Motion |
| Backend | Python 3.12, FastAPI 0.115, SQLAlchemy 2.0 async, asyncpg, Pydantic v2 |
| Poller | Go 1.25, go-routeros/v3, pgx/v5, nats.go |
| Database | PostgreSQL 17 + TimescaleDB 2.17, Row-Level Security |
| Cache | Redis 7 |
| Message Bus | NATS with JetStream |
| KMS | OpenBao 2.1 (Transit secret engine) |
| VPN | WireGuard |
| Auth | SRP-6a (zero-knowledge password auth), JWT session tokens |
| Reports | Jinja2 + WeasyPrint (PDF generation) |
| Containerization | Docker Compose (dev, staging, production profiles) |

---

## Quick Start

See the full [Quick Start Guide](../QUICKSTART.md) for detailed instructions.

```bash
# Clone and run the setup wizard
git clone https://github.com/staack/the-other-dude.git
cd the-other-dude
python3 setup.py
```

The setup wizard configures your database, generates encryption keys, initializes the secret management service (OpenBao), sets up your reverse proxy, builds the Docker images, and starts everything. No manual `.env` editing required.

Three environment profiles are available:

| Environment | Frontend | API | Notes |
|-------------|----------|-----|-------|
| Dev | `localhost:3000` | `localhost:8001` | Hot-reload, volume-mounted source |
| Staging | `localhost:3080` | `localhost:8081` | Built images, staging secrets |
| Production | `localhost` (port 80) | Internal (proxied) | Gunicorn workers, log rotation |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start](../QUICKSTART.md) | Get running in minutes |
| [Deployment Guide](DEPLOYMENT.md) | Production deployment, TLS, backups |
| [Architecture](ARCHITECTURE.md) | System design, data flows, multi-tenancy |
| [Security Model](SECURITY.md) | Zero-knowledge auth, encryption, RLS, RBAC |
| [User Guide](USER-GUIDE.md) | End-user guide for all features |
| [API Reference](API.md) | REST API endpoints and authentication |
| [Configuration](CONFIGURATION.md) | Environment variables and tuning |

---

## Screenshots

See the [documentation site](https://theotherdude.net) for screenshots.

---

## Project Structure

```
backend/            Python FastAPI backend
frontend/           React TypeScript frontend
poller/             Go microservice for device polling
infrastructure/     Helm charts, Dockerfiles, OpenBao init
docs/               Documentation
docker-compose.yml  Base compose (infrastructure services)
docker-compose.override.yml   Dev overrides (hot-reload)
docker-compose.staging.yml    Staging profile
docker-compose.prod.yml       Production profile
docker-compose.observability.yml  Prometheus + Grafana
```

---

## License

Business Source License 1.1. Self-hosted. Your data stays on your infrastructure. SaaS use requires a commercial agreement.
