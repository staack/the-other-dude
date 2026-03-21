# TOD - The Other Dude: User Guide

Fleet management platform for MikroTik RouterOS devices.

---

## Getting Started

### First Login

1. Navigate to the portal URL provided by your administrator.
2. Log in with the admin credentials created during initial deployment.
3. Complete **security enrollment** — the portal uses zero-knowledge authentication, meaning your password never leaves your browser, so a unique Secret Key is generated for your account.
4. **Save your Emergency Kit PDF immediately.** This PDF contains your Secret Key, which you will need to log in from any new browser or device. Without it, you cannot recover access.
5. Complete the **Setup Wizard** to create your first organization and add your first device.

### Setup Wizard

The Setup Wizard launches automatically for first-time super_admin users. It walks through three steps:

- **Step 1 -- Create Organization**: Enter a name for your tenant (organization). This is the top-level container for all your devices, users, and configuration.
- **Step 2 -- Add Device**: Enter the IP address, API port (default 8729 for TLS — this is the RouterOS API-SSL service, which must be enabled on the device under IP > Services), and RouterOS credentials for your first device. The portal will attempt to connect and verify the device.
- **Step 3 -- Verify & Complete**: The portal polls the device to confirm connectivity. Once verified, you are taken to the dashboard.

You can always add more organizations and devices later from the sidebar.

---

## Navigation

TOD uses a collapsible sidebar organized into task-based sections. Press `[` to toggle the sidebar between expanded (240px) and collapsed (48px) views. On mobile, the sidebar opens as an overlay.

The sidebar footer contains the theme toggle (dark/light), connection status indicator, logout button, and UI scale selector. For super_admin users, the tenant selector is in the sidebar header.

### Operate

| Item | Description |
|------|-------------|
| **Overview** | Overview of your fleet with device status cards, active alerts, metrics sparklines, and "APs Needing Attention" wireless health card. The landing page after login. |
| **Devices** | Fleet table with search, sort, and filter. Click any device row to open its detail page. |
| **Sites** | Tower and site management -- organize devices by physical location with sectors, health monitoring, wireless links, and site-scoped alerts. |
| **Alerts** | Live alert feed with filtering by severity (info, warning, critical) and acknowledgment actions. |
| **Wireless** | Fleet-wide view of all discovered AP-to-CPE wireless connections with signal, CCQ, TX/RX rates, and link state. |
| **Map** | Geographic fleet map with status-colored markers and automatic clustering. Devices with coordinates appear on the map; clusters reflect aggregate health (green = all online, red = all offline, amber = mixed). |

### Act

| Item | Description |
|------|-------------|
| **Config** | Browse and edit RouterOS configuration paths in real-time. Select a device from the header dropdown. |
| **Templates** | Create and manage reusable configuration templates. |
| **Firmware** | Check for RouterOS updates and schedule firmware upgrades across your fleet. |
| **Commands** | Execute RouterOS CLI commands across selected devices in bulk. |

### Low-Frequency (bottom of sidebar)

| Item | Description |
|------|-------------|
| **Organizations** | Create and manage tenants for multi-tenant operation. Each tenant's data is fully isolated -- users in one organization cannot see another's devices or data. |
| **Certificates** | Internal Certificate Authority management -- generate, deploy, and rotate TLS certificates for your devices. |
| **VPN** | WireGuard VPN tunnel management -- create, deploy, and monitor tunnels between devices. |
| **Alert Rules** | Define threshold-based alert rules on device metrics with configurable severity and notification channels. |
| **Maintenance** | Schedule maintenance windows to suppress alerts during planned work. |
| **Settings** | System configuration and profile settings. |
| **Audit Log** | Immutable, append-only log of all operations -- configuration changes, logins, user management, and admin actions. |
| **Reports** | Generate and export PDF reports: fleet summary, device health, compliance, and SLA. |

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
3. **Subnet Scanner** -- enter a network range (e.g., `192.168.1.0/24` covers all addresses from .0 to .255) to auto-discover MikroTik devices on the network.

When adding a device, provide:

- **IP Address** -- the management IP of the RouterOS device.
- **API Port** -- default is 8729 (TLS). Ensure the API-SSL service is enabled on your router (RouterOS: IP > Services > api-ssl).
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
| **Wireless** | Wireless metrics charts -- client count, signal strength (dBm), and CCQ (Client Connection Quality) per interface over time. |

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

Toggle between **Simple** (guided) and **Standard** (full config editor) modes at any time. Your mode preference is saved in the browser — switching browsers resets it to Simple mode.

---

## Monitoring & Alerts

### Alert Rules

Create threshold-based rules that fire when device metrics cross defined boundaries:

- Select the metric to monitor (CPU, memory, disk, interface traffic, wireless signal, wireless link quality, uptime, etc.).
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

Default wireless alert rules (Signal Degraded at -75 dBm (a level where connection quality noticeably degrades), CCQ Low at 50% (indicating a poor or congested wireless link)) are automatically created when a new tenant is added.

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
- **Envelope encryption** -- configuration backups and audit logs are encrypted at rest, with each organization getting its own encryption key managed by the built-in key management service.

### Roles and Permissions

| Role | Capabilities |
|------|-------------|
| **super_admin** | Full platform access across all tenants. Can create organizations, manage all users, and access system settings. |
| **admin** | Full access within their tenant. Can manage users, devices, and configuration for their organization. |
| **operator** | Can view devices, apply configurations, and acknowledge alerts. Cannot manage users or organization settings. |
| **viewer** | Read-only access to devices, dashboards, and reports within their tenant. |

### Credential Storage

Device credentials (RouterOS username/password) are encrypted at rest and only decrypted in memory when the poller connects to the device.

---

## Theme & UI Scale

TOD supports dark and light modes:

- **Dark mode** (default) uses the Midnight Slate palette.
- **Light mode** provides a clean, high-contrast alternative.
- Toggle using the theme button in the **sidebar footer**, or let the portal follow your system preference.
- The command palette and all UI components adapt to the active theme.

A **UI scale selector** is available in the sidebar footer with three options: 100%, 110%, and 125%. This adjusts the base font size and layout density across the entire interface. Your preference is saved per browser.

---

## Tower & Site Management

Sites represent physical locations in your network -- towers, rooftops, equipment rooms, or any place where you deploy devices. Sectors let you subdivide a site by antenna direction. Together they give you a structured view of your wireless infrastructure.

### Creating a Site

1. Navigate to **Sites** in the sidebar.
2. Click **New Site**.
3. Fill in the site details:
   - **Name** (required) -- a descriptive label for the location (e.g., "North Ridge Tower").
   - **Address** -- street address or landmark description.
   - **Latitude / Longitude** -- GPS coordinates. Devices at this site inherit these coordinates on the fleet map.
   - **Elevation** -- tower or rooftop height in meters.
   - **Notes** -- free-text field for internal reference.
4. Click **Create Site**.

The Sites list shows all sites with search filtering. Click any site to open its detail page.

### Site Detail Page

The site detail page shows a summary header with device count, online count, online percentage, and active alert count. Four tabs provide deeper views:

| Tab | Description |
|-----|-------------|
| **Health Grid** | Card grid of every device assigned to the site showing live CPU, memory, and uptime. Cards are color-coded by status (green = online, red = offline). Click any card to open the device detail page. |
| **Sectors** | Sector-based view of devices and their connected CPE clients. Shows per-sector aggregate stats (client count, average signal, link count). |
| **Links** | Table of all wireless links at the site, grouped by AP, with signal strength, CCQ, TX/RX rates, link state, and expandable signal history charts. |
| **Alerts** | Site-scoped alert rules and alert event history. Create and manage rules that apply to this specific site or sector. |

### Creating Sectors

Sectors organize access points within a site by antenna direction (e.g., "North 0-120" or "South Sector"). To create a sector:

1. Open a site detail page and switch to the **Sectors** tab.
2. Click **Add Sector**.
3. Enter:
   - **Name** (required) -- a label for the sector direction (e.g., "North Sector").
   - **Azimuth** -- compass bearing in degrees (0-360) representing the antenna direction. 0 is north, 90 is east, 180 is south, 270 is west.
   - **Description** -- optional notes about the sector.
4. Click **Create Sector**.

Each sector section is collapsible and shows a header with device count, connected client count, average signal strength, and link count. Devices within a sector are listed with their connected CPEs and link states inline.

### Assigning Devices to Sites and Sectors

Devices are assigned to a site from the device detail page or from the Sites section. Once assigned, you can further assign a device to a specific sector:

1. Open the site detail page and switch to the **Sectors** tab.
2. Each device row has a sector assignment dropdown on the right.
3. Select a sector from the dropdown to assign the device, or select **Unassigned** to remove the sector assignment.

Devices that belong to a site but have no sector assignment appear in the **Unassigned** section at the bottom of the Sectors tab.

---

## Wireless Links

TOD automatically discovers wireless connections between access points (APs) and client premise equipment (CPEs) in your fleet. When the poller detects a registration table entry on an AP that matches a CPE device in your fleet, it creates a wireless link record.

### Link States

Each wireless link has a state that reflects its current health:

| State | Meaning |
|-------|---------|
| **Discovered** | A new AP-CPE connection has been detected for the first time. |
| **Active** | The link is up with recent poll data confirming connectivity. |
| **Degraded** | The link is connected but signal or quality metrics have dropped below healthy thresholds. |
| **Down** | The link has not been seen in recent polls -- the CPE is likely disconnected. |
| **Stale** | The link has not been seen for an extended period. The connection may no longer exist. |

Link states transition automatically based on poll results and missed-poll counters.

### Viewing Wireless Links

There are two ways to view wireless links:

- **Fleet-wide**: Navigate to **Wireless** in the sidebar. This shows all discovered links across your organization, filterable by state (active, degraded, down, stale).
- **Per-site**: Open a site detail page and switch to the **Links** tab. This shows only the links associated with devices assigned to that site.

Both views group links by AP device. Each CPE row shows signal strength (dBm), CCQ percentage, TX/RX data rates, link state, and time since last seen.

### Signal History

Click any CPE row in the wireless links table to expand an inline signal history chart. The chart shows signal strength over time with three lines:

- **Average signal** (solid blue) -- the primary trend line.
- **Min / Max signal** (dashed) -- the range boundaries.

The background is color-banded: green for strong signal (above -65 dBm), yellow for moderate (-65 to -80 dBm), and red for weak (below -80 dBm).

Use the time range selector in the chart header to switch between **24h**, **7d**, and **30d** views. This helps you spot intermittent degradation, seasonal patterns, or gradual signal drift that might not be obvious from a single snapshot.

---

## Site Alerts

Site alert rules let you define thresholds scoped to an entire site or a specific sector, rather than individual devices. This is useful for detecting systemic issues across a tower location.

### Creating a Site Alert Rule

1. Open the site detail page and switch to the **Alerts** tab.
2. Click **Add Alert Rule**.
3. Configure the rule:
   - **Rule type** -- choose from:
     - *Device Offline Percent* -- fires when the percentage of offline devices at the site exceeds the threshold.
     - *Device Offline Count* -- fires when a specific number of devices go offline.
     - *Sector Signal Average* -- fires when the average signal strength across a sector drops below the threshold.
     - *Sector Client Drop* -- fires when the number of connected clients in a sector drops by more than the threshold.
     - *Signal Degradation* -- fires when individual link signal degrades past a threshold.
   - **Scope** -- apply the rule to the entire site or narrow it to a specific sector.
   - **Threshold** -- the numeric value and unit that triggers the alert.
   - **Severity** -- warning or critical.
4. Click **Create Rule**.

Alert events appear in the site's Alerts tab with timestamps, severity, the triggering message, and consecutive hit count. Active alerts can be resolved manually by operators.

---

## Fleet Map

The fleet map provides a geographic view of all devices that have coordinates assigned (either directly on the device or inherited from their site).

- Navigate to **Map** in the sidebar.
- Devices appear as color-coded markers: **green** for online, **red** for offline.
- When devices are geographically close, they automatically cluster into numbered circles. Cluster color reflects aggregate health: green if all devices in the cluster are online, red if all are offline, and amber if mixed.
- Click a cluster to zoom in and see individual markers. Click a device marker to see its status summary and link to its detail page.
- Super admins can filter the map by organization using the dropdown in the toolbar.
- The map auto-fits to show all mapped devices when loaded. The toolbar shows how many of your devices have coordinates assigned.

---

## Tips

- Use the **command palette** (`Cmd+K`) for the fastest way to navigate. It searches pages, devices, and actions.
- The **Audit Trail** is immutable -- every configuration change, login, and admin action is recorded and cannot be deleted.
- **Safe Apply** is your safety net for remote devices. If a firewall change locks you out, the automatic revert restores access.
- **API Keys** (prefixed `mktp_`) provide programmatic access at operator-level permissions for automation and scripting.
- The **Topology** view automatically arranges devices for readability. Toggle shared subnet edges to reduce visual clutter on complex networks.

---

*TOD -- The Other Dude is not affiliated with or endorsed by MikroTik (SIA Mikrotikls).*
