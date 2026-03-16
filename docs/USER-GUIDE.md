# TOD - The Other Dude: User Guide

MSP fleet management platform for MikroTik RouterOS devices.

---

## Getting Started

### First Login

1. Navigate to the portal URL provided by your administrator.
2. Log in with the admin credentials created during initial deployment.
3. Complete **SRP security enrollment** -- the portal uses zero-knowledge authentication (SRP-6a), so a unique Secret Key is generated for your account.
4. **Save your Emergency Kit PDF immediately.** This PDF contains your Secret Key, which you will need to log in from any new browser or device. Without it, you cannot recover access.
5. Complete the **Setup Wizard** to create your first organization and add your first device.

### Setup Wizard

The Setup Wizard launches automatically for first-time super_admin users. It walks through three steps:

- **Step 1 -- Create Organization**: Enter a name for your tenant (organization). This is the top-level container for all your devices, users, and configuration.
- **Step 2 -- Add Device**: Enter the IP address, API port (default 8729 for TLS), and RouterOS credentials for your first device. The portal will attempt to connect and verify the device.
- **Step 3 -- Verify & Complete**: The portal polls the device to confirm connectivity. Once verified, you are taken to the dashboard.

You can always add more organizations and devices later from the sidebar.

---

## Navigation

TOD uses a collapsible sidebar with four sections. Press `[` to toggle the sidebar between expanded (240px) and collapsed (48px) views. On mobile, the sidebar opens as an overlay.

### Fleet

| Item | Description |
|------|-------------|
| **Dashboard** | Overview of your fleet with device status cards, active alerts, metrics sparklines, and "APs Needing Attention" wireless health card. The landing page after login. |
| **Devices** | Fleet table with search, sort, and filter. Click any device row to open its detail page. |
| **Map** | Geographic map view of device locations. |

### Manage

| Item | Description |
|------|-------------|
| **Config Editor** | Browse and edit RouterOS configuration paths in real-time. Select a device from the header dropdown. |
| **Batch Config** | Apply configuration changes across multiple devices simultaneously using templates. |
| **Bulk Commands** | Execute RouterOS CLI commands across selected devices in bulk. |
| **Templates** | Create and manage reusable configuration templates. |
| **Firmware** | Check for RouterOS updates and schedule firmware upgrades across your fleet. |
| **Maintenance** | Schedule maintenance windows to suppress alerts during planned work. |
| **VPN** | WireGuard VPN tunnel management -- create, deploy, and monitor tunnels between devices. |
| **Certificates** | Internal Certificate Authority management -- generate, deploy, and rotate TLS certificates for your devices. |
### Monitor

| Item | Description |
|------|-------------|
| **Topology** | Interactive network map showing device connections and shared subnets, rendered with ReactFlow and Dagre layout. |
| **Alerts** | Live alert feed with filtering by severity (info, warning, critical) and acknowledgment actions. |
| **Alert Rules** | Define threshold-based alert rules on device metrics with configurable severity and notification channels. |
| **Audit Trail** | Immutable, append-only log of all operations -- configuration changes, logins, user management, and admin actions. |
| **Transparency** | KMS access event dashboard showing encryption key usage across your organization (admin only). |
| **Reports** | Generate and export PDF reports: fleet summary, device health, compliance, and SLA. |

### Admin

| Item | Description |
|------|-------------|
| **Users** | User management with role-based access control (RBAC). Assign roles: super_admin, admin, operator, viewer. |
| **Organizations** | Create and manage tenants for multi-tenant MSP operation. Each tenant has isolated data via PostgreSQL row-level security. |
| **API Keys** | Generate and manage programmatic access tokens (prefixed `mktp_`) with operator-level permissions. |
| **Settings** | System configuration, theme toggle (dark/light), and profile settings. |
| **About** | Platform version, feature summary, and project information. |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Open command palette for quick navigation and actions |
| `[` | Toggle sidebar collapsed/expanded |
| `?` | Show keyboard shortcut help dialog |
| `g d` | Go to Dashboard |
| `g f` | Go to Firmware |
| `g t` | Go to Topology |
| `g a` | Go to Alerts |

The command palette (`Cmd+K`) provides fuzzy search across all pages, devices, and common actions. It is accessible in both dark and light themes.

---

## Device Management

### Adding Devices

There are several ways to add devices to your fleet:

1. **Setup Wizard** -- automatically offered on first login.
2. **Fleet Table** -- click the "Add Device" button from the Devices page.
3. **Subnet Scanner** -- enter a CIDR range (e.g., `192.168.1.0/24`) to auto-discover MikroTik devices on the network.

When adding a device, provide:

- **IP Address** -- the management IP of the RouterOS device.
- **API Port** -- default is 8729 (TLS). The portal connects via the RouterOS binary API protocol.
- **Credentials** -- username and password for the device. Credentials are encrypted at rest with AES-256-GCM.

### Device Detail Page

Click any device in the fleet table to open its detail page. Tabs include:

| Tab | Description |
|-----|-------------|
| **Overview** | System info, uptime, hardware model, RouterOS version, resource usage, and interface status summary. |
| **Interfaces** | Real-time traffic graphs for each network interface. |
| **Config** | Browse the full device configuration tree by RouterOS path. |
| **Firewall** | View and manage firewall filter rules, NAT rules, and address lists. |
| **DHCP** | Active DHCP leases, server configuration, and address pools. |
| **Backups** | Configuration backup timeline with side-by-side diff viewer to compare changes over time. |
| **Clients** | Connected clients and wireless registrations. |
| **Wireless** | Wireless metrics charts -- client count, signal strength (dBm), and CCQ per interface over time. |

### Config Editor

The Config Editor provides direct access to RouterOS configuration paths (e.g., `/ip/address`, `/ip/firewall/filter`, `/interface/bridge`).

- Select a device from the header dropdown.
- Navigate the configuration tree to browse, add, edit, or delete entries.
- Two apply modes are available:
  - **Standard Apply** -- changes are applied immediately.
  - **Safe Apply** -- two-phase commit with automatic panic-revert. Changes are applied, and you have a confirmation window to accept them. If the confirmation times out (device becomes unreachable), changes automatically revert to prevent lockouts.

Safe Apply is strongly recommended for firewall rules and routing changes on remote devices.

### Simple Config

Simple Config provides a consumer-router-style interface modeled after Linksys and Ubiquiti UIs. It is designed for operators who prefer guided configuration over raw RouterOS paths.

Seven category tabs:

1. **Internet** -- WAN connection type, PPPoE, DHCP client settings.
2. **LAN / DHCP** -- LAN addressing, DHCP server and pool configuration.
3. **WiFi** -- Wireless SSID, security, and channel settings.
4. **Port Forwarding** -- NAT destination rules for inbound services.
5. **Firewall** -- Simplified firewall rule management.
6. **DNS** -- DNS server and static DNS entries.
7. **System** -- Device identity, timezone, NTP, admin password.

Toggle between **Simple** (guided) and **Standard** (full config editor) modes at any time. Per-device settings are stored in browser localStorage.

---

## Monitoring & Alerts

### Alert Rules

Create threshold-based rules that fire when device metrics cross defined boundaries:

- Select the metric to monitor (CPU, memory, disk, interface traffic, wireless signal, wireless CCQ, uptime, etc.).
- Set the threshold value and comparison operator.
- Choose severity: **info**, **warning**, or **critical**.
- Assign one or more notification channels.

### Notification Channels

Alerts can be delivered through multiple channels:

| Channel | Description |
|---------|-------------|
| **Email** | SMTP-based email notifications. Configure server, port, and recipients. |
| **Webhook** | HTTP POST to any URL with a JSON payload containing alert details. |
| **Slack** | Slack incoming webhook with Block Kit formatting for rich alert messages. |

Default wireless alert rules (Signal Degraded at -75 dBm, CCQ Low at 50%) are automatically created when a new tenant is added.

### Maintenance Windows

Schedule maintenance periods to suppress alerts during planned work:

- Define start and end times.
- Apply to specific devices or fleet-wide.
- Alerts generated during the window are recorded but do not trigger notifications.
- Maintenance windows can be recurring or one-time.

---

## Reports

Generate PDF reports from the Reports page. Four report types are available:

| Report | Content |
|--------|---------|
| **Fleet Summary** | Overall fleet health, device counts by status, top alerts, and aggregate statistics. |
| **Device Health** | Per-device detailed report with hardware info, resource trends, and recent events. |
| **Compliance** | Security posture audit -- firmware versions, default credentials, firewall policy checks. |
| **SLA** | Uptime and availability metrics over a selected period with percentage calculations. |

Reports are generated as downloadable PDFs using server-side rendering.

---

## Security

### Zero-Knowledge Architecture

TOD uses a 1Password-style hybrid zero-knowledge model:

- **SRP-6a authentication** -- your password never leaves the browser. The server verifies a cryptographic proof without knowing the password.
- **Secret Key** -- a 128-bit key in `A3-XXXXXX` format, generated during enrollment. Combined with your password for two-secret key derivation (2SKD).
- **Emergency Kit** -- a downloadable PDF containing your Secret Key. Store it securely offline; you need it to log in from new browsers.
- **Envelope encryption** -- configuration backups and audit logs are encrypted at rest using per-tenant keys managed by the KMS (OpenBao Transit).

### Roles and Permissions

| Role | Capabilities |
|------|-------------|
| **super_admin** | Full platform access across all tenants. Can create organizations, manage all users, and access system settings. |
| **admin** | Full access within their tenant. Can manage users, devices, and configuration for their organization. |
| **operator** | Can view devices, apply configurations, and acknowledge alerts. Cannot manage users or organization settings. |
| **viewer** | Read-only access to devices, dashboards, and reports within their tenant. |

### Credential Storage

Device credentials (RouterOS username/password) are encrypted at rest with AES-256-GCM (Fernet) and only decrypted in memory by the poller when connecting to devices.

---

## Theme

TOD supports dark and light modes:

- **Dark mode** (default) uses the Midnight Slate palette.
- **Light mode** provides a clean, high-contrast alternative.
- Toggle in **Settings** or let the portal follow your system preference.
- The command palette and all UI components adapt to the active theme.

---

## Tips

- Use the **command palette** (`Cmd+K`) for the fastest way to navigate. It searches pages, devices, and actions.
- The **Audit Trail** is immutable -- every configuration change, login, and admin action is recorded and cannot be deleted.
- **Safe Apply** is your safety net for remote devices. If a firewall change locks you out, the automatic revert restores access.
- **API Keys** (prefixed `mktp_`) provide programmatic access at operator-level permissions for automation and scripting.
- The **Topology** view uses automatic Dagre layout. Toggle shared subnet edges to reduce visual clutter on complex networks.

---

*TOD -- The Other Dude is not affiliated with or endorsed by MikroTik (SIA Mikrotikls).*
