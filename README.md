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
- **Remote Access** -- WinBox TCP tunnels and browser-based SSH terminal for managing devices behind NAT. One-click connection through the WireGuard VPN overlay.
- **WireGuard VPN Onboarding** -- Create device + VPN peer in one transaction. Generates ready-to-paste RouterOS commands for devices behind NAT.
- **PDF Reports** -- Fleet summary, device detail, security audit, and performance reports generated server-side.
- **Command Palette UX** -- Cmd+K quick navigation, keyboard shortcuts, dark/light mode, smooth page transitions, and skeleton loaders throughout.

---

## Architecture

```
Routers
   ↓
Pollers (Go)
   ↓
NATS Event Bus
   ↓
API + TimescaleDB
   ↓
Web UI
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TanStack Router + Query, Tailwind CSS, Vite |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg |
| Poller | Go 1.25, go-routeros/v3, pgx/v5, nats.go |
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
# Clone and run the setup wizard
git clone https://github.com/staack/the-other-dude.git && cd the-other-dude
python3 setup.py
```

The setup wizard handles everything interactively:

- Pre-flight checks (Docker, ports, RAM)
- Database password configuration
- Cryptographic key generation (JWT, encryption)
- Admin account creation
- SMTP configuration (optional)
- Domain and reverse proxy setup (Caddy, nginx, Apache, HAProxy, Traefik)
- OpenBao (KMS) bootstrap
- Docker image builds
- Stack startup and health checks

On first launch, the web UI walks you through enrolling your Secret Key, adding your
first organization, and onboarding your first device.

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
