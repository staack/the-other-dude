import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import type { HealthMetricPoint } from '@/lib/api'

interface HealthChartProps {
  data: HealthMetricPoint[]
  metric: 'avg_cpu' | 'avg_mem_pct' | 'avg_disk_pct' | 'avg_temp'
  label: string
  color: string
  unit: string // "%" or "C"
  maxY?: number // 100 for percentages
}

function formatBucket(bucket: string): string {
  const d = new Date(bucket)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${min}`
}

function CustomTooltip({
  active,
  payload,
  label,
  unit,
}: { active?: boolean; payload?: Array<{ value?: number }>; label?: string; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary shadow-lg">
      <div className="mb-1 text-text-muted">{label}</div>
      <div>
        {(payload[0].value ?? 0).toFixed(1)}
        {unit}
      </div>
    </div>
  )
}

export function HealthChart({ data, metric, label, color, unit, maxY }: HealthChartProps) {
  const gradId = `hc-grad-${metric}`

  const chartData = data.map((point) => ({
    bucket: formatBucket(point.bucket),
    value: point[metric] ?? 0,
  }))

  const domain: [number | string, number | string] = maxY !== undefined ? [0, maxY] : ['auto', 'auto']

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-secondary">{label}</div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={domain}
            tickFormatter={(v: number) => `${v}${unit}`}
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip unit={unit} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
