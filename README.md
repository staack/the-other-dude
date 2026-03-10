# The Other Dude

**Self-hosted MikroTik fleet management for MSPs.**

> **Warning**
> This software is in active development and testing. It is **not yet ready for production use**. APIs, database schemas, and features may change without notice. Use at your own risk.

TOD is a multi-tenant platform for managing RouterOS devices at scale. It replaces
the chaos of juggling WinBox sessions and SSH terminals across hundreds of routers
with a single, centralized web interface -- fleet visibility, configuration management,
real-time monitoring, and zero-knowledge security, all self-hosted on your infrastructure.

---

## Key Features

- **Fleet Management** -- Dashboard with device health, uptime sparklines, virtual-scrolled fleet table, geographic map, and subnet discovery.
- **Configuration Push with Panic-Revert** -- Two-phase config deployment ensures you never brick a remote device. Batch config, templates, and git-backed version history with one-click restore.
- **Real-Time Monitoring** -- Live CPU, memory, disk, and interface traffic via Server-Sent Events backed by NATS JetStream. Configurable alert rules with email, webhook, and Slack notifications.
- **Zero-Knowledge Security** -- 1Password-style architecture. SRP-6a authentication (server never sees your password), per-tenant envelope encryption via Transit KMS, Emergency Kit export.
- **Multi-Tenant with PostgreSQL RLS** -- Full organization isolation enforced at the database layer. Four roles: super_admin, admin, operator, viewer.
- **Internal Certificate Authority** -- Issue and deploy TLS certificates to RouterOS devices via SFTP. Three-tier TLS fallback for maximum compatibility.
- **WireGuard VPN Onboarding** -- Create device + VPN peer in one transaction. Generates ready-to-paste RouterOS commands for devices behind NAT.
- **PDF Reports** -- Fleet summary, device detail, security audit, and performance reports generated server-side.
- **Command Palette UX** -- Cmd+K quick navigation, keyboard shortcuts, dark/light mode, smooth page transitions, and skeleton loaders throughout.

---

## Architecture

```
                        +----------------+
                        |    Frontend    |
                        |  React / Vite  |
                        +-------+--------+
                                |
                           /api/ proxy
                                |
                        +-------v--------+
                        |    Backend     |
                        |    FastAPI     |
                        +--+----+-----+--+
                           |    |     |
             +-------------+    |     +--------------+
             |                  |                    |
      +------v-------+  +------v------+  +----------v----------+
      |  PostgreSQL   |  |    Redis    |  |        NATS         |
      |  TimescaleDB  |  |   (locks,   |  |     JetStream       |
      |    (RLS)      |  |   caching)  |  |     (pub/sub)       |
      +------^-------+  +------^------+  +----------^----------+
             |                  |                    |
      +------+------------------+--------------------+------+
      |                   Go Poller                         |
      |         RouterOS binary API (port 8729 TLS)         |
      +---------------------------+-------------------------+
                                  |
                       +----------v-----------+
                       |    RouterOS Fleet    |
                       |    (your devices)    |
                       +----------------------+
```

The **Go poller** communicates with RouterOS devices using the binary API over TLS,
publishing metrics to NATS and persisting to PostgreSQL with TimescaleDB hypertables.
The **FastAPI backend** enforces tenant isolation via Row-Level Security and streams
real-time events to the **React frontend** over SSE. **OpenBao** provides Transit
secret engine for per-tenant envelope encryption.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TanStack Router + Query, Tailwind CSS, Vite |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg |
| Poller | Go 1.24, go-routeros/v3, pgx/v5, nats.go |
| Database | PostgreSQL 17 + TimescaleDB, Row-Level Security |
| Cache / Locks | Redis 7 |
| Message Bus | NATS with JetStream |
| KMS | OpenBao (Transit secret engine) |
| VPN | WireGuard |
| Auth | SRP-6a (zero-knowledge), JWT |
| Reports | Jinja2 + WeasyPrint |

---

## Quick Start

```bash
# Clone and configure
git clone https://github.com/your-org/tod.git && cd tod
cp .env.example .env
# Edit .env -- set CREDENTIAL_ENCRYPTION_KEY and JWT_SECRET_KEY at minimum

# Build images sequentially (avoids OOM on low-RAM machines)
docker compose --profile full build api
docker compose --profile full build poller
docker compose --profile full build frontend

# Start the full stack
docker compose --profile full up -d

# Open the UI
open http://localhost:3000
```

On first launch, the setup wizard walks you through creating a super admin account,
enrolling your Secret Key, adding your first organization, and onboarding your first device.

---

## Documentation

Full documentation is available at [theotherdude.net](https://theotherdude.net).

See the documentation site for screenshots and feature walkthroughs.

---

## License

[Business Source License 1.1](LICENSE)

Free for production use managing up to 1,000 devices with no limitations. Deployments
exceeding 1,000 managed devices require a commercial license. See the LICENSE file
for full terms.

For commercial licensing inquiries: [license@theotherdude.net](mailto:license@theotherdude.net)

For support: [support@theotherdude.net](mailto:support@theotherdude.net) — support inquiries are best-effort unless covered by a support license.

---

## The Name

"The Other Dude" -- because every MSP needs one. When the network is down at 2 AM
and someone has to fix it, TOD is the other dude on the job. The Big Lebowski inspired,
the rug really ties the room together.
