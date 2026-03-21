import { useQuery } from '@tanstack/react-query'
import { Shield, Lock, Globe } from 'lucide-react'
import { networkApi, type VpnTunnel } from '@/lib/networkApi'
import { LoadingText } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

interface VpnTabProps {
  tenantId: string
  deviceId: string
  active: boolean
}

/** Format byte count to human-readable string. */
function formatBytes(bytes: string | null): string {
  if (!bytes) return '--'
  const n = parseInt(bytes, 10)
  if (isNaN(n)) return bytes
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`
  return `${n} B`
}

/** VPN type configuration for icons and colors. */
const VPN_TYPE_CONFIG = {
  wireguard: {
    icon: Shield,
    label: 'WireGuard',
    color: 'hsl(var(--accent))',
  },
  ipsec: {
    icon: Lock,
    label: 'IPsec',
    color: 'hsl(var(--info))',
  },
  l2tp: {
    icon: Globe,
    label: 'L2TP',
    color: 'hsl(var(--success))',
  },
} as const

function TunnelRow({ tunnel }: { tunnel: VpnTunnel }) {
  const config = VPN_TYPE_CONFIG[tunnel.type]
  const Icon = config.icon
  const isUp = tunnel.status === 'connected' || tunnel.status === 'established'

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-elevated/30 transition-colors">
      {/* Type */}
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <span
            className="flex items-center justify-center w-6 h-6 rounded"
            style={{ backgroundColor: config.color + '20', color: config.color }}
          >
            <Icon className="w-3.5 h-3.5" />
          </span>
          <Badge color={config.color}>{config.label}</Badge>
        </div>
      </td>
      {/* Remote Endpoint */}
      <td className="py-2.5 px-3 font-mono text-xs text-text-primary">
        {tunnel.remote_endpoint}
      </td>
      {/* Status */}
      <td className="py-2.5 px-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            isUp ? 'text-success' : 'text-text-muted'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-success' : 'bg-text-muted'}`}
          />
          {tunnel.status}
        </span>
      </td>
      {/* Uptime */}
      <td className="py-2.5 px-3 text-xs text-text-secondary font-mono">
        {tunnel.uptime ?? '--'}
      </td>
      {/* RX */}
      <td className="py-2.5 px-3 text-xs text-text-secondary font-mono text-right">
        {formatBytes(tunnel.rx_bytes)}
      </td>
      {/* TX */}
      <td className="py-2.5 px-3 text-xs text-text-secondary font-mono text-right">
        {formatBytes(tunnel.tx_bytes)}
      </td>
    </tr>
  )
}

export function VpnTab({ tenantId, deviceId, active }: VpnTabProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['vpn-tunnels', tenantId, deviceId],
    queryFn: () => networkApi.getVpnTunnels(tenantId, deviceId),
    refetchInterval: active ? 30_000 : false,
    enabled: active,
  })

  if (isLoading) {
    return (
      <div className="mt-4 py-8 text-center">
        <LoadingText />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-panel p-6 text-center text-sm text-error">
        Failed to load VPN tunnels. The device may not support this feature.
      </div>
    )
  }

  if (!data || data.tunnels.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-panel p-8 text-center">
        <Shield className="w-10 h-10 mx-auto mb-3 text-text-muted opacity-40" />
        <p className="text-sm font-medium text-text-primary mb-1">
          No active VPN tunnels
        </p>
        <p className="text-xs text-text-muted max-w-sm mx-auto">
          VPN tunnels will appear here when WireGuard peers, IPsec SAs, or L2TP
          connections are active on this device.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-panel overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border bg-elevated/50">
            <th className="py-2 px-3 text-xs font-medium text-text-muted">Type</th>
            <th className="py-2 px-3 text-xs font-medium text-text-muted">Remote Endpoint</th>
            <th className="py-2 px-3 text-xs font-medium text-text-muted">Status</th>
            <th className="py-2 px-3 text-xs font-medium text-text-muted">Uptime</th>
            <th className="py-2 px-3 text-xs font-medium text-text-muted text-right">RX</th>
            <th className="py-2 px-3 text-xs font-medium text-text-muted text-right">TX</th>
          </tr>
        </thead>
        <tbody>
          {data.tunnels.map((tunnel, i) => (
            <TunnelRow key={`${tunnel.type}-${tunnel.remote_endpoint}-${i}`} tunnel={tunnel} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
