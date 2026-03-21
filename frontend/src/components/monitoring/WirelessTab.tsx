import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  CartesianGrid,
} from 'recharts'
import { metricsApi, type WirelessLatest, type WirelessMetricPoint } from '@/lib/api'
import { TimeRangeSelector, getTimeRange, shouldAutoRefresh } from './TimeRangeSelector'
import { SignalBar } from './SignalBar'

interface WirelessTabProps {
  tenantId: string
  deviceId: string
  active?: boolean
}

interface WirelessInterfaceSection {
  interfaceName: string
  latest: WirelessLatest | undefined
  history: WirelessMetricPoint[]
}

function ClientCountMiniChart({ data }: { data: WirelessMetricPoint[] }) {
  const chartData = data.map((p) => ({
    bucket: p.bucket,
    clients: p.avg_clients ?? 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={80}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="client-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="bucket" hide />
        <Area
          type="monotone"
          dataKey="clients"
          stroke="#A78BFA"
          strokeWidth={1.5}
          fill="url(#client-grad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function WirelessInterfaceCard({ section }: { section: WirelessInterfaceSection }) {
  const { interfaceName, latest, history } = section

  return (
    <div className="rounded-lg border border-border bg-panel p-4 space-y-3">
      {/* Interface name header */}
      <h3 className="text-sm font-medium text-text-primary">{interfaceName}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Signal strength */}
        <div className="space-y-1">
          <div className="text-xs text-text-muted">Signal Strength</div>
          {latest?.avg_signal != null ? (
            <SignalBar signal={latest.avg_signal} />
          ) : (
            <div className="text-sm text-text-muted">—</div>
          )}
        </div>

        {/* CCQ */}
        <div className="space-y-1">
          <div className="text-xs text-text-muted">CCQ</div>
          <div className="text-sm text-text-primary">
            {latest?.ccq != null ? `${latest.ccq}%` : '—'}
          </div>
        </div>

        {/* Frequency */}
        <div className="space-y-1">
          <div className="text-xs text-text-muted">Frequency</div>
          <div className="text-sm text-text-primary">
            {latest?.frequency != null ? `${latest.frequency} MHz` : '—'}
          </div>
        </div>

        {/* Client count */}
        <div className="space-y-1">
          <div className="text-xs text-text-muted">Connected Clients</div>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {latest?.client_count ?? '—'}
            </span>
          </div>
          {history.length > 0 && (
            <div className="mt-1">
              <ClientCountMiniChart data={history} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function WirelessTab({ tenantId, deviceId, active = true }: WirelessTabProps) {
  const [timeRange, setTimeRange] = useState('6h')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { data: latestWireless } = useQuery({
    queryKey: ['metrics', 'wireless-latest', deviceId],
    queryFn: () => metricsApi.wirelessLatest(tenantId, deviceId),
    refetchInterval: 60_000,
    enabled: active,
  })

  const { data: historicalWireless, isLoading } = useQuery({
    queryKey: ['metrics', 'wireless', deviceId, timeRange, customStart, customEnd],
    queryFn: () => {
      const { start, end } = getTimeRange(timeRange, customStart, customEnd)
      return metricsApi.wireless(tenantId, deviceId, start, end)
    },
    refetchInterval: shouldAutoRefresh(timeRange),
    enabled: active,
  })

  const handleCustomRangeChange = (start: string, end: string) => {
    setCustomStart(start)
    setCustomEnd(end)
  }

  // Gather all wireless interface names from latest and historical data
  const interfaceNames = new Set<string>()
  latestWireless?.forEach((w) => interfaceNames.add(w.interface))
  historicalWireless?.forEach((w) => interfaceNames.add(w.interface))

  const sections: WirelessInterfaceSection[] = [...interfaceNames].map((ifaceName) => ({
    interfaceName: ifaceName,
    latest: latestWireless?.find((w) => w.interface === ifaceName),
    history: historicalWireless?.filter((w) => w.interface === ifaceName) ?? [],
  }))

  const hasNoWireless =
    !isLoading && latestWireless?.length === 0 && (!historicalWireless || historicalWireless.length === 0)

  return (
    <div className="space-y-4 mt-4">
      <TimeRangeSelector
        value={timeRange}
        onChange={setTimeRange}
        customStart={customStart}
        customEnd={customEnd}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {isLoading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-panel p-4 h-48 animate-pulse" />
          ))}
        </div>
      ) : hasNoWireless ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-text-muted">
          No wireless interfaces detected on this device.
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <WirelessInterfaceCard key={section.interfaceName} section={section} />
          ))}
        </div>
      )}
    </div>
  )
}
