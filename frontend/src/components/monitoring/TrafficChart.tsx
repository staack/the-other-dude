import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import type { InterfaceMetricPoint } from '@/lib/api'

interface TrafficChartProps {
  data: InterfaceMetricPoint[]
  interfaceName: string
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${bps} bps`
}

function formatBucket(bucket: string, useDate: boolean): string {
  const d = new Date(bucket)
  if (useDate) {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${mm}/${dd}`
  }
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${min}`
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; dataKey?: string; name?: string; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary shadow-lg">
      <div className="mb-1 text-text-muted">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span style={{ color: entry.color }}>&#9632;</span>
          <span>{entry.name === 'avg_rx_bps' ? 'RX' : 'TX'}</span>
          <span className="ml-auto pl-4">{formatBps(entry.value ?? 0)}</span>
        </div>
      ))}
    </div>
  )
}

export function TrafficChart({ data, interfaceName }: TrafficChartProps) {
  // Determine if we should show dates vs times based on data span
  const useDate =
    data.length >= 2
      ? new Date(data[data.length - 1].bucket).getTime() - new Date(data[0].bucket).getTime() >
        2 * 24 * 60 * 60 * 1000
      : false

  const chartData = data.map((point) => ({
    bucket: formatBucket(point.bucket, useDate),
    avg_rx_bps: point.avg_rx_bps ?? 0,
    avg_tx_bps: point.avg_tx_bps ?? 0,
  }))

  return (
    <div>
      <div className="mb-1 text-xs text-text-muted">{interfaceName}</div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`rx-grad-${interfaceName}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`tx-grad-${interfaceName}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4ADE80" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#4ADE80" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={formatBps}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="avg_rx_bps"
            name="avg_rx_bps"
            stroke="#38BDF8"
            strokeWidth={1.5}
            fill={`url(#rx-grad-${interfaceName})`}
          />
          <Area
            type="monotone"
            dataKey="avg_tx_bps"
            name="avg_tx_bps"
            stroke="#4ADE80"
            strokeWidth={1.5}
            fill={`url(#tx-grad-${interfaceName})`}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-1 flex gap-4 text-xs text-text-muted">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-chart-1" />
          RX
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-chart-2" />
          TX
        </span>
      </div>
    </div>
  )
}
