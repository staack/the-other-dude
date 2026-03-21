import { useQuery } from '@tanstack/react-query'
import { metricsApi, type InterfaceMetricPoint } from '@/lib/api'
import { LoadingText } from '@/components/ui/skeleton'

interface InterfaceGaugesProps {
  tenantId: string
  deviceId: string
  active: boolean
}

/** Heuristic speed defaults (bps) based on interface name prefix. */
function inferMaxSpeed(ifaceName: string): number {
  const name = ifaceName.toLowerCase()
  if (name.startsWith('wlan') || name.startsWith('wifi') || name.startsWith('cap')) {
    return 300_000_000 // 300 Mbps for wireless
  }
  if (name.startsWith('sfp') || name.startsWith('sfpplus') || name.startsWith('qsfp')) {
    return 10_000_000_000 // 10 Gbps for SFP+
  }
  if (name.startsWith('lte') || name.startsWith('ppp')) {
    return 100_000_000 // 100 Mbps for LTE/PPP
  }
  // Default to 1 Gbps for ethernet
  return 1_000_000_000
}

/** Format bps to a human-readable string. */
function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${Math.round(bps)} bps`
}

/** Format max speed for display. */
function formatMaxSpeed(bps: number): string {
  if (bps >= 1_000_000_000) return `${bps / 1_000_000_000} Gbps`
  if (bps >= 1_000_000) return `${bps / 1_000_000} Mbps`
  return `${bps / 1_000} Kbps`
}

/** Get color class based on utilization percentage. */
function getBarColor(pct: number): string {
  if (pct >= 80) return 'bg-error'
  if (pct >= 50) return 'bg-warning'
  return 'bg-success'
}

interface GaugeBarProps {
  label: string
  value: number
  maxSpeed: number
  direction: 'RX' | 'TX'
}

function GaugeBar({ value, maxSpeed, direction }: GaugeBarProps) {
  const pct = Math.min((value / maxSpeed) * 100, 100)
  const colorClass = getBarColor(pct)

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium text-text-muted w-6 text-right shrink-0">
        {direction}
      </span>
      <div className="flex-1 h-3 bg-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${Math.max(pct, 0.5)}%` }}
        />
      </div>
      <span className="text-xs font-mono text-text-secondary w-24 text-right shrink-0">
        {formatBps(value)}
      </span>
    </div>
  )
}

export function InterfaceGauges({ tenantId, deviceId, active }: InterfaceGaugesProps) {
  // Fetch the list of interfaces
  const { data: interfaces } = useQuery({
    queryKey: ['interfaces-list', tenantId, deviceId],
    queryFn: () => metricsApi.interfaceList(tenantId, deviceId),
    enabled: active,
  })

  // Fetch latest interface metrics (last 5 minutes)
  const now = new Date()
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)
  const { data: metricsData, isLoading } = useQuery({
    queryKey: ['interface-gauges', tenantId, deviceId],
    queryFn: () =>
      metricsApi.interfaces(
        tenantId,
        deviceId,
        fiveMinAgo.toISOString(),
        now.toISOString(),
      ),
    refetchInterval: active ? 15_000 : false,
    enabled: active,
  })

  if (isLoading) {
    return (
      <div className="py-8 text-center">
        <LoadingText />
      </div>
    )
  }

  if (!interfaces || interfaces.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-text-muted">
        No interface data available.
      </div>
    )
  }

  // Compute latest values per interface from recent metrics
  const latestByIface = new Map<string, { rx: number; tx: number }>()
  if (metricsData && metricsData.length > 0) {
    // Group by interface and take the latest bucket
    const grouped = new Map<string, InterfaceMetricPoint[]>()
    for (const point of metricsData) {
      const key = point.interface
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(point)
    }
    for (const [ifName, points] of grouped) {
      // Sort by bucket descending, take latest
      points.sort((a, b) => b.bucket.localeCompare(a.bucket))
      const latest = points[0]
      latestByIface.set(ifName, {
        rx: latest.avg_rx_bps ?? latest.max_rx_bps ?? 0,
        tx: latest.avg_tx_bps ?? latest.max_tx_bps ?? 0,
      })
    }
  }

  return (
    <div className="space-y-2">
      {interfaces.map((ifaceName) => {
        const maxSpeed = inferMaxSpeed(ifaceName)
        const values = latestByIface.get(ifaceName) ?? { rx: 0, tx: 0 }

        return (
          <div key={ifaceName} className="rounded-lg border border-border bg-panel p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-text-primary">{ifaceName}</span>
              <span className="text-[10px] text-text-muted">
                / {formatMaxSpeed(maxSpeed)}
              </span>
            </div>
            <div className="space-y-1">
              <GaugeBar
                label={ifaceName}
                value={values.rx}
                maxSpeed={maxSpeed}
                direction="RX"
              />
              <GaugeBar
                label={ifaceName}
                value={values.tx}
                maxSpeed={maxSpeed}
                direction="TX"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
