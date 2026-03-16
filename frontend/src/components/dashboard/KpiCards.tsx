import { Server, Wifi, AlertTriangle, Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
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
  icon: React.ReactNode
  label: string
  value: number
  suffix?: string
  decimals?: number
  colorClass: string
  highlight?: boolean
}

function KpiCard({
  icon,
  label,
  value,
  suffix,
  decimals = 0,
  colorClass,
  highlight,
}: KpiCardProps) {
  const animatedValue = useAnimatedCounter(value, 800, decimals)

  return (
    <Card
      className={cn(
        'bg-gradient-to-br from-[#f8f8ff] to-elevated dark:from-elevated dark:to-[#16162a] border-border transition-colors',
        highlight && 'border-warning/30',
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
              {label}
            </span>
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  'text-2xl font-medium tabular-nums font-mono',
                  colorClass,
                )}
              >
                {decimals > 0 ? animatedValue.toFixed(decimals) : animatedValue}
              </span>
              {suffix && (
                <span className="text-sm font-medium text-text-muted">
                  {suffix}
                </span>
              )}
            </div>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg bg-elevated/50',
              colorClass,
            )}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
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
        icon={<Server className="h-5 w-5" />}
        label="Total Devices"
        value={totalDevices}
        colorClass="text-accent"
      />
      <KpiCard
        icon={<Wifi className="h-5 w-5" />}
        label="Online"
        value={onlinePercent}
        suffix="%"
        decimals={1}
        colorClass="text-success"
      />
      <KpiCard
        icon={<AlertTriangle className="h-5 w-5" />}
        label="Active Alerts"
        value={activeAlerts}
        colorClass={activeAlerts > 0 ? 'text-warning' : 'text-text-muted'}
        highlight={activeAlerts > 0}
      />
      <KpiCard
        icon={<Activity className="h-5 w-5" />}
        label="Total Bandwidth"
        value={bandwidth.value}
        suffix={bandwidth.unit}
        decimals={bwDecimals}
        colorClass="text-accent"
      />
    </div>
  )
}
