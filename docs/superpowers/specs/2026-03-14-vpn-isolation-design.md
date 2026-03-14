# Per-Tenant VPN Network Isolation — Design Spec

## Overview

Isolate WireGuard VPN networks per tenant so that devices in one tenant's VPN cannot reach devices in another tenant's VPN. Each tenant gets a unique `/24` subnet auto-allocated from `10.10.0.0/16`, with iptables rules blocking cross-subnet traffic.

**Branch:** `main` (this is a security fix, not SaaS-specific)

## Design Decisions

- **Single `wg0` interface** — WireGuard handles thousands of peers on one interface with negligible performance impact. No need for per-tenant interfaces.
- **Per-tenant `/24` subnets** — allocated from `10.10.0.0/16`, giving 255 tenants (index 1–255). Index 0 is reserved. Expandable to `10.0.0.0/8` if needed (note: `_next_available_ip()` materializes all hosts in the subnet, so subnets larger than `/24` require refactoring that function).
- **Auto-allocation only** — `setup_vpn()` picks the next available subnet. No manual override.
- **Global config sync** — one `wg0.conf` with all tenants' peers. Rebuilt on any VPN change. Protected by a PostgreSQL advisory lock to prevent concurrent writes.
- **Global server keypair** — a single WireGuard server keypair stored in `system_settings`, replacing per-tenant server keys. Generated on first `setup_vpn()` call or during migration.
- **iptables isolation** — cross-subnet traffic blocked at the WireGuard container's firewall. IPv6 blocked too.
- **Device-side config is untrusted** — isolation relies entirely on server-side enforcement (AllowedIPs `/32` + iptables DROP). A malicious device operator changing their `allowed-address` to `10.10.0.0/16` on their router gains nothing — the server only routes their assigned `/32`.

## Data Model Changes

### Modified: `vpn_config`

| Column | Change | Description |
|--------|--------|-------------|
| `subnet_index` | **New column**, integer, unique, not null | Maps to third octet: index 1 = `10.10.1.0/24` |
| `subnet` | Default changes | No longer `10.10.0.0/24`; derived from `subnet_index` |
| `server_address` | Default changes | No longer `10.10.0.1/24`; derived as `10.10.{index}.1/24` |
| `server_private_key` | **Deprecated** | Kept in table for rollback safety but no longer used. Global key in `system_settings` is authoritative. |
| `server_public_key` | **Deprecated** | Same — kept but unused. All peers use the global public key. |

### New: `system_settings` entries

| Key | Description |
|-----|-------------|
| `vpn_server_private_key` | Global WireGuard server private key (encrypted with CREDENTIAL_ENCRYPTION_KEY) |
| `vpn_server_public_key` | Global WireGuard server public key (plaintext) |

### Allocation Logic

```
subnet_index = first available integer in range [1, 255] not already in vpn_config
subnet = 10.10.{subnet_index}.0/24
server_address = 10.10.{subnet_index}.1/24
```

Allocation query (atomic, gap-filling):
```sql
SELECT MIN(x) FROM generate_series(1, 255) AS x
WHERE x NOT IN (SELECT subnet_index FROM vpn_config)
```

If no index available → 422 "VPN subnet pool exhausted".

Unique constraint on `subnet_index` provides safety against race conditions. On conflict, retry once.

## VPN Service Changes

### `setup_vpn(db, tenant_id, endpoint)`

Current behavior: creates VpnConfig with hardcoded `10.10.0.0/24` and generates a per-tenant server keypair.

New behavior:
1. **Get or create global server keypair:** check `system_settings` for `vpn_server_private_key`. If not found, generate a new keypair and store both the private key (encrypted) and public key. This happens on the first `setup_vpn()` call on a fresh install.
2. Allocate next `subnet_index` using the gap-filling query
3. Set `subnet = 10.10.{index}.0/24`
4. Set `server_address = 10.10.{index}.1/24`
5. Store the global public key in `server_public_key` (for backward compat / display)
6. Call `sync_wireguard_config(db)` (global, not per-tenant)

### `sync_wireguard_config(db)`

Current signature: `sync_wireguard_config(db, tenant_id)` — builds config for one tenant.

New signature: `sync_wireguard_config(db)` — builds config for ALL tenants.

**Concurrency protection:** acquire a PostgreSQL advisory lock (`pg_advisory_xact_lock(hash)`) before writing. This prevents two simultaneous peer additions from producing a corrupt `wg0.conf`.

**Atomic write:** write to a temp file, then `os.rename()` to `wg0.conf`. This prevents the WireGuard container from reading a partially-written file.

New behavior:
1. Acquire advisory lock
2. Read global server private key from `system_settings` (decrypt it)
3. Query ALL enabled `VpnConfig` rows (across all tenants, using admin engine to bypass RLS)
4. For each, query enabled `VpnPeer` rows
5. Build single `wg0.conf`:

```ini
[Interface]
Address = 10.10.0.1/16
ListenPort = 51820
PrivateKey = {global_server_private_key}

# --- Tenant: {tenant_name} (10.10.1.0/24) ---
[Peer]
PublicKey = {peer_public_key}
PresharedKey = {preshared_key}
AllowedIPs = 10.10.1.2/32

# --- Tenant: {tenant_name_2} (10.10.2.0/24) ---
[Peer]
PublicKey = {peer_public_key}
PresharedKey = {preshared_key}
AllowedIPs = 10.10.2.2/32
```

6. Write to temp file, `os.rename()` to `wg0.conf`
7. Touch `.reload` flag
8. Release advisory lock

### `_next_available_ip(db, tenant_id, config)`

No changes needed — already scoped to `tenant_id` and uses the config's subnet. With unique subnets per tenant, IPs are naturally isolated. Note: this function materializes all `/24` hosts into a list, which is fine for `/24` (253 entries) but must be refactored if subnets larger than `/24` are ever used.

### `add_peer(db, tenant_id, device_id, ...)`

Changes:
- Calls `sync_wireguard_config(db)` instead of `sync_wireguard_config(db, tenant_id)`
- **Validate `additional_allowed_ips`:** if provided, reject any subnet that overlaps with `10.10.0.0/16` (the VPN address space). Only non-VPN subnets are allowed (e.g., `192.168.1.0/24` for site-to-site routing). This prevents a tenant from claiming another tenant's VPN subnet in their AllowedIPs.

### `remove_peer(db, tenant_id, peer_id)`

Minor change: calls `sync_wireguard_config(db)` instead of `sync_wireguard_config(db, tenant_id)`.

### Tenant deletion hook

When a tenant is deleted (CASCADE deletes vpn_config and vpn_peers), call `sync_wireguard_config(db)` to regenerate `wg0.conf` without the deleted tenant's peers. Add this to the tenant deletion endpoint.

### `read_wg_status()`

No changes — status is keyed by peer public key, which is unique globally. The existing `get_peer_handshake()` lookup continues to work.

## WireGuard Container Changes

### iptables Isolation Rules

Update `docker-data/wireguard/custom-cont-init.d/10-forwarding.sh`:

```bash
#!/bin/sh
# Enable forwarding between Docker network and WireGuard tunnel
# Idempotent: check before adding to prevent duplicates on restart
iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT

# Block cross-subnet traffic on wg0 (tenant isolation)
# Peers in 10.10.1.0/24 cannot reach peers in 10.10.2.0/24
iptables -C FORWARD -i wg0 -o wg0 -j DROP 2>/dev/null || iptables -A FORWARD -i wg0 -o wg0 -j DROP

# Block IPv6 forwarding on wg0 (prevent link-local bypass)
ip6tables -C FORWARD -i wg0 -j DROP 2>/dev/null || ip6tables -A FORWARD -i wg0 -j DROP

# NAT for return traffic
iptables -C POSTROUTING -t nat -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE

echo "WireGuard forwarding and tenant isolation rules applied"
```

Rules use `iptables -C` (check) before `-A` (append) to be idempotent across container restarts.

The key isolation layers:

1. **WireGuard AllowedIPs** — each peer can only send to its own `/32` IP (cryptographic enforcement)
2. **iptables `wg0 → wg0` DROP** — blocks any traffic that enters and exits the tunnel interface (peer-to-peer)
3. **iptables IPv6 DROP** — prevents link-local IPv6 bypass
4. **Separate subnets** — no IP collisions between tenants
5. **`additional_allowed_ips` validation** — blocks tenants from claiming VPN address space

### Server Address

The `[Interface] Address` changes from `10.10.0.1/24` to `10.10.0.1/16` so the server can route to all tenant subnets.

## Routing Changes

### Poller & API

No changes needed. Both already route `10.10.0.0/16` via the WireGuard container.

### setup.py

Update `prepare_data_dirs()` to write the updated forwarding script with idempotent rules and IPv6 blocking.

## RouterOS Command Generation

### `onboard_device()` and `get_peer_config()`

These generate RouterOS commands for device setup. Changes:

- `allowed-address` changes from `10.10.0.0/24` to `10.10.{index}.0/24` (tenant's specific subnet)
- `endpoint-address` and `endpoint-port` unchanged
- Server public key changes to the global server public key (read from `system_settings`)

## Migration

### Database Migration

1. Generate global server keypair:
   - Create keypair using `generate_wireguard_keypair()`
   - Store in `system_settings`: `vpn_server_private_key` (encrypted), `vpn_server_public_key` (plaintext)
2. Add `subnet_index` column to `vpn_config` (integer, unique, not null)
3. For existing VpnConfig rows (may be multiple if multiple tenants have VPN):
   - Assign sequential `subnet_index` values starting from 1
   - Update `subnet` to `10.10.{index}.0/24`
   - Update `server_address` to `10.10.{index}.1/24`
4. For existing VpnPeer rows:
   - Remap IPs: `10.10.0.X` → `10.10.{tenant's index}.X` (preserve the host octet)
   - Example: Tenant A (index 1) peer at `10.10.0.2` → `10.10.1.2`. Tenant B (index 2) peer at `10.10.0.2` → `10.10.2.2`. No collision.
5. Regenerate `wg0.conf` using the new global sync function

### Device-Side Update Required

This is a **breaking change** for existing VPN peers. After migration:
- Devices need updated RouterOS commands:
  - New server public key (global key replaces per-tenant key)
  - New VPN IP address (`10.10.0.X` → `10.10.{index}.X`)
  - New allowed-address (`10.10.{index}.0/24`)
- The API should expose a "regenerate commands" endpoint or show a banner in the UI indicating that VPN reconfiguration is needed.

### Migration Communication

After the migration runs:
- Log a warning with the list of affected devices
- Show a banner in the VPN UI: "VPN network updated — devices need reconfiguration. Click here for updated commands."
- The existing "View Setup Commands" button in the UI will show the correct updated commands.

## API Changes

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/api/tenants/{id}/vpn` | `setup_vpn` allocates subnet_index, uses global server key |
| `GET` | `/api/tenants/{id}/vpn` | Returns tenant's specific subnet info |
| `GET` | `/api/tenants/{id}/vpn/peers/{id}/config` | Returns commands with tenant-specific subnet and global server key |
| `POST` | `/api/tenants/{id}/vpn/peers` | Validates `additional_allowed_ips` doesn't overlap `10.10.0.0/16` |
| `DELETE` | `/api/tenants/{id}` | Calls `sync_wireguard_config(db)` after cascade delete |

### No New Endpoints

The isolation is transparent — tenants don't need to know about it.

## Error Handling

| Scenario | HTTP Status | Message |
|----------|-------------|---------|
| No available subnet index (255 tenants with VPN) | 422 | "VPN subnet pool exhausted" |
| Subnet index conflict (race condition) | — | Retry allocation once |
| `additional_allowed_ips` overlaps VPN space | 422 | "Additional allowed IPs must not overlap the VPN address space (10.10.0.0/16)" |

## Testing

- Create two tenants with VPN enabled → verify they get different subnets (`10.10.1.0/24`, `10.10.2.0/24`)
- Add peers in both → verify IPs don't collide
- From tenant A's device, attempt to ping tenant B's device → verify it's blocked
- Verify `wg0.conf` contains peers from both tenants with correct subnets
- Verify iptables rules are in place after container restart (idempotent)
- Verify `additional_allowed_ips` with `10.10.x.x` subnet is rejected
- Delete a tenant → verify `wg0.conf` is regenerated without its peers
- Disable a tenant's VPN → verify peers excluded from `wg0.conf`
- Empty state (no enabled tenants) → verify `wg0.conf` has only `[Interface]` section
- Migration: multiple tenants sharing `10.10.0.0/24` → verify correct remapping to unique subnets

## Audit Logging

- Subnet allocated (tenant_id, subnet_index, subnet)
- Global server keypair generated (first-run event)
- VPN config regenerated (triggered by which operation)

## Out of Scope

- Multiple WireGuard interfaces (not needed at current scale)
- Manual subnet assignment
- IPv6 VPN support (IPv6 is blocked as a security measure)
- Per-tenant WireGuard listen ports
- VPN-level rate limiting or bandwidth quotas
