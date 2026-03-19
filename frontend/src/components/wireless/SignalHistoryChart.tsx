import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import { signalHistoryApi, type SignalHistoryPoint } from '@/lib/api'
import { cn } from '@/lib/utils'

type Range = '24h' | '7d' | '30d'

interface SignalHistoryChartProps {
  tenantId: string
  deviceId: string
  macAddress: string
}

function formatTimestamp(ts: string, range: Range): string {
  const d = new Date(ts)
  if (range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (range === '7d') {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function SignalHistoryChart({ tenantId, deviceId, macAddress }: SignalHistoryChartProps) {
  const [range, setRange] = useState<Range>('7d')

  const { data, isLoading } = useQuery({
    queryKey: ['signal-history', tenantId, deviceId, macAddress, range],
    queryFn: () => signalHistoryApi.get(tenantId, deviceId, macAddress, range),
  })

  const chartData = (data?.items ?? []).map((pt: SignalHistoryPoint) => ({
    ...pt,
    label: formatTimestamp(pt.timestamp, range),
  }))

  return (
    <div className="rounded-lg bg-elevated/40 border border-border/50 p-3">
      {/* Header with range selector */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          Signal History
        </span>
        <div className="flex gap-1">
          {(['24h', '7d', '30d'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={(e) => { e.stopPropagation(); setRange(r) }}
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium rounded transition-colors',
                range === r
                  ? 'bg-accent text-white'
                  : 'bg-elevated text-text-muted hover:text-text-secondary',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart body */}
      {isLoading ? (
        <div className="flex items-center justify-center h-[200px]">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-sm text-text-muted">
          No signal data available for this time range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />

            {/* Color band reference areas */}
            <ReferenceArea y1={-65} y2={0} fill="#22c55e" fillOpacity={0.05} />
            <ReferenceArea y1={-80} y2={-65} fill="#eab308" fillOpacity={0.05} />
            <ReferenceArea y1={-100} y2={-80} fill="#ef4444" fillOpacity={0.05} />

            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              label={{
                value: 'dBm',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 10, fill: 'rgba(255,255,255,0.4)' },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(15,15,20,0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '11px',
              }}
              labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  signal_avg: 'Avg Signal',
                  signal_min: 'Min Signal',
                  signal_max: 'Max Signal',
                }
                return [`${value} dBm`, labels[name] ?? name]
              }}
            />
            <Line
              type="monotone"
              dataKey="signal_avg"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="signal_min"
              stroke="rgba(59,130,246,0.3)"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="signal_max"
              stroke="rgba(59,130,246,0.3)"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
