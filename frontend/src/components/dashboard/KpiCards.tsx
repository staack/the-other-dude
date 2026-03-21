import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { cn } from '@/lib/utils'

export interface KpiCardsProps {
  totalDevices: number
  onlinePercent: number // 0-100
  activeAlerts: number
  totalBandwidthBps: number // bytes per second
}

/**
 * Formats bytes-per-second into a human-readable bandwidth string.
 * Auto-scales through bps, Kbps, Mbps, Gbps.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function formatBandwidth(bps: number): { value: number; unit: string } {
  if (bps < 1_000) return { value: bps, unit: 'bps' }
  if (bps < 1_000_000) return { value: bps / 1_000, unit: 'Kbps' }
  if (bps < 1_000_000_000) return { value: bps / 1_000_000, unit: 'Mbps' }
  return { value: bps / 1_000_000_000, unit: 'Gbps' }
}

interface KpiCardProps {
  label: string
  value: number
  suffix?: string
  decimals?: number
  colorClass: string
  highlight?: boolean
}

function KpiCard({
  label,
  value,
  suffix,
  decimals = 0,
  colorClass,
  highlight,
}: KpiCardProps) {
  const animatedValue = useAnimatedCounter(value, 800, decimals)

  return (
    <div
      className={cn(
        'bg-panel border border-border px-3 py-2.5 rounded-sm',
        highlight && 'border-l-2 border-l-warning',
      )}
    >
      <div className="text-[7px] font-medium text-text-muted uppercase tracking-[1.5px] mb-1">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            'text-lg font-medium tabular-nums font-mono',
            colorClass,
          )}
        >
          {decimals > 0 ? animatedValue.toFixed(decimals) : animatedValue}
        </span>
        {suffix && (
          <span className="text-xs text-text-muted">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

export function KpiCards({
  totalDevices,
  onlinePercent,
  activeAlerts,
  totalBandwidthBps,
}: KpiCardsProps) {
  const bandwidth = formatBandwidth(totalBandwidthBps)
  // Determine appropriate decimal places for bandwidth display
  const bwDecimals = bandwidth.value < 10 ? 2 : bandwidth.value < 100 ? 1 : 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        label="Total Devices"
        value={totalDevices}
        colorClass="text-accent"
      />
      <KpiCard
        label="Online"
        value={onlinePercent}
        suffix="%"
        decimals={1}
        colorClass="text-success"
      />
      <KpiCard
        label="Active Alerts"
        value={activeAlerts}
        colorClass={activeAlerts > 0 ? 'text-warning' : 'text-text-muted'}
        highlight={activeAlerts > 0}
      />
      <KpiCard
        label="Total Bandwidth"
        value={bandwidth.value}
        suffix={bandwidth.unit}
        decimals={bwDecimals}
        colorClass="text-accent"
      />
    </div>
  )
}
