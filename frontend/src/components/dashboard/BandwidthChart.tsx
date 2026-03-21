import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface BandwidthDevice {
  hostname: string
  deviceId: string
  tenantId: string
  bandwidthBps: number
}

interface BandwidthChartProps {
  devices: BandwidthDevice[]
}

/** Formats bps into a concise label for chart axes and tooltips. */
function formatBw(bps: number): string {
  if (bps < 1_000) return `${bps} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

/** Formats bps into a short axis tick (no decimal for compact display). */
function formatAxisTick(value: number): string {
  if (value === 0) return '0'
  if (value < 1_000) return `${value}`
  if (value < 1_000_000) return `${Math.round(value / 1_000)}K`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(0)}M`
  return `${(value / 1_000_000_000).toFixed(1)}G`
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; payload: { hostname: string } }>
}

function BwTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2 text-xs">
      <p className="font-medium text-text-primary">{item.payload.hostname}</p>
      <p className="text-text-secondary">{formatBw(item.value)}</p>
    </div>
  )
}

export function BandwidthChart({ devices }: BandwidthChartProps) {
  const chartHeight = Math.max(200, devices.length * 36)

  return (
    <Card className="bg-panel border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-text-secondary">
          Top Bandwidth Consumers
        </CardTitle>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            No bandwidth data available
          </div>
        ) : (
          <div style={{ width: '100%', height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={devices}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
              >
                <XAxis
                  type="number"
                  tickFormatter={formatAxisTick}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="hostname"
                  width={120}
                  tick={{ fontSize: 11, fill: '#cbd5e1' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<BwTooltip />}
                  cursor={{ fill: '#334155', opacity: 0.5 }}
                />
                <Bar
                  dataKey="bandwidthBps"
                  fill="#38BDF8"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
