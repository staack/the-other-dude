# Quick Start

Get The Other Dude running in minutes.

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- **Python 3.6+** (for the setup wizard)
- **Git**

## Install

```bash
git clone https://github.com/staack/the-other-dude.git
cd the-other-dude
python3 setup.py
```

The setup wizard walks you through everything:

1. Configures your environment (database credentials, encryption keys, reverse proxy)
2. Initializes the secret management service (OpenBao)
3. Builds Docker images (API, poller, frontend)
4. Starts the full stack
5. Verifies all services are healthy

No manual `.env` editing required.

## First Login

Once the stack is running:

1. Open the URL shown by the setup wizard in your browser.
2. Log in with the admin credentials created during setup.
3. Complete security enrollment — your password never leaves your browser.
4. **Save your Emergency Kit PDF.** You need this to log in from new browsers or devices.
5. Follow the Setup Wizard to create your first organization and add your first device.

## Adding Your First Device

You need:

- The device's **management IP address**
- **API port** — default is 8729 (the RouterOS API-SSL service must be enabled: IP > Services > api-ssl)
- **RouterOS credentials** — a username and password with API access

The platform connects to devices using the RouterOS binary API over TLS. No SNMP configuration is needed.

## What's Next

- [User Guide](docs/USER-GUIDE.md) — full walkthrough of all features
- [Deployment Guide](docs/DEPLOYMENT.md) — production deployment, TLS, backups
- [Configuration](docs/CONFIGURATION.md) — environment variables and tuning
- [Architecture](docs/ARCHITECTURE.md) — system design and data flows
