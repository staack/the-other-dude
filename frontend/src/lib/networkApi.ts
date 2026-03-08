/**
 * Network Intelligence API client -- types and functions for topology,
 * VPN tunnels, device logs, client tracking, and interface utilization.
 */

import { api } from './api'
import { configEditorApi } from './configEditorApi'

// ---------------------------------------------------------------------------
// Topology Types
// ---------------------------------------------------------------------------

export interface TopologyNode {
  id: string
  hostname: string
  ip: string
  status: string
  model: string | null
  uptime: string | null
}

export interface TopologyEdge {
  source: string
  target: string
  label: string
}

export interface TopologyResponse {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

// ---------------------------------------------------------------------------
// VPN Types
// ---------------------------------------------------------------------------

export interface VpnTunnel {
  type: 'wireguard' | 'ipsec' | 'l2tp'
  remote_endpoint: string
  status: string
  uptime: string | null
  rx_bytes: string | null
  tx_bytes: string | null
  local_address: string | null
  // WireGuard-specific
  public_key?: string
  last_handshake?: string
  // IPsec-specific
  state?: string
}

export interface VpnResponse {
  tunnels: VpnTunnel[]
  device_id: string
}

// ---------------------------------------------------------------------------
// Log Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  time: string
  topics: string
  message: string
}

export interface LogsResponse {
  logs: LogEntry[]
  device_id: string
  count: number
}

// ---------------------------------------------------------------------------
// Client Device Types
// ---------------------------------------------------------------------------

export interface ClientDevice {
  mac: string
  ip: string
  interface: string
  hostname: string | null
  status: 'reachable' | 'stale'
  signal_strength: string | null
  tx_rate: string | null
  rx_rate: string | null
  uptime: string | null
  is_wireless: boolean
}

export interface ClientsResponse {
  clients: ClientDevice[]
  device_id: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseWireGuardPeers(entries: Record<string, string>[]): VpnTunnel[] {
  return entries.map((entry) => ({
    type: 'wireguard' as const,
    remote_endpoint: entry['current-endpoint-address'] || entry['endpoint-address'] || 'unknown',
    status: entry['current-endpoint-address'] ? 'connected' : 'waiting',
    uptime: null,
    rx_bytes: entry.rx || null,
    tx_bytes: entry.tx || null,
    local_address: entry['allowed-address'] || null,
    public_key: entry['public-key'] || undefined,
    last_handshake: entry['last-handshake'] || undefined,
  }))
}

function parseIpsecPeers(entries: Record<string, string>[]): VpnTunnel[] {
  return entries.map((entry) => ({
    type: 'ipsec' as const,
    remote_endpoint: entry['remote-address'] || 'unknown',
    status: entry.state || 'established',
    uptime: entry.uptime || null,
    rx_bytes: entry['rx-bytes'] || null,
    tx_bytes: entry['tx-bytes'] || null,
    local_address: entry['local-address'] || null,
    state: entry.state || undefined,
  }))
}

function parseL2tpServers(entries: Record<string, string>[]): VpnTunnel[] {
  return entries
    .filter((entry) => entry.running === 'true' || entry['client-address'])
    .map((entry) => ({
      type: 'l2tp' as const,
      remote_endpoint: entry['client-address'] || entry.name || 'unknown',
      status: entry.running === 'true' ? 'connected' : 'inactive',
      uptime: entry.uptime || null,
      rx_bytes: null,
      tx_bytes: null,
      local_address: entry['local-address'] || null,
    }))
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const networkApi = {
  /**
   * Fetch network topology (nodes + edges) for a tenant.
   * Cached on backend with 5-minute Redis TTL.
   */
  getTopology: (tenantId: string) =>
    api.get<TopologyResponse>(`/api/tenants/${tenantId}/topology`).then((r) => r.data),

  /**
   * Fetch VPN tunnels by browsing WireGuard peers, IPsec active-peers,
   * and L2TP server interfaces via the existing config editor browse API.
   * Uses Promise.allSettled so missing VPN types return empty (not errors).
   */
  getVpnTunnels: async (tenantId: string, deviceId: string): Promise<VpnResponse> => {
    const [wgResult, ipsecResult, l2tpResult] = await Promise.allSettled([
      configEditorApi.browse(tenantId, deviceId, '/interface/wireguard/peers'),
      configEditorApi.browse(tenantId, deviceId, '/ip/ipsec/active-peers'),
      configEditorApi.browse(tenantId, deviceId, '/interface/l2tp-server/server'),
    ])

    const tunnels: VpnTunnel[] = []

    if (wgResult.status === 'fulfilled' && wgResult.value.success) {
      tunnels.push(...parseWireGuardPeers(wgResult.value.entries))
    }
    if (ipsecResult.status === 'fulfilled' && ipsecResult.value.success) {
      tunnels.push(...parseIpsecPeers(ipsecResult.value.entries))
    }
    if (l2tpResult.status === 'fulfilled' && l2tpResult.value.success) {
      tunnels.push(...parseL2tpServers(l2tpResult.value.entries))
    }

    return { tunnels, device_id: deviceId }
  },

  /**
   * Fetch connected client devices (ARP + DHCP + wireless) from the backend.
   */
  getClients: (tenantId: string, deviceId: string) =>
    api
      .get<ClientsResponse>(`/api/tenants/${tenantId}/devices/${deviceId}/clients`)
      .then((r) => r.data),

  /**
   * Fetch device syslog entries from the backend logs endpoint.
   */
  getDeviceLogs: (
    tenantId: string,
    deviceId: string,
    params?: { limit?: number; topic?: string; search?: string },
  ) =>
    api
      .get<LogsResponse>(`/api/tenants/${tenantId}/devices/${deviceId}/logs`, { params })
      .then((r) => r.data),
}
