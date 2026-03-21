import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { metricsApi } from '@/lib/api'
import { TimeRangeSelector, getTimeRange, shouldAutoRefresh } from './TimeRangeSelector'
import { TrafficChart } from './TrafficChart'

interface InterfacesTabProps {
  tenantId: string
  deviceId: string
  active?: boolean
}

export function InterfacesTab({ tenantId, deviceId, active = true }: InterfacesTabProps) {
  const [timeRange, setTimeRange] = useState('6h')
  const [selectedInterface, setSelectedInterface] = useState<string | null>(null)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { data: interfaces } = useQuery({
    queryKey: ['metrics', 'interface-list', deviceId],
    queryFn: () => metricsApi.interfaceList(tenantId, deviceId),
    enabled: active,
  })

  const { data: trafficData, isLoading } = useQuery({
    queryKey: ['metrics', 'traffic', deviceId, timeRange, selectedInterface, customStart, customEnd],
    queryFn: () => {
      const { start, end } = getTimeRange(timeRange, customStart, customEnd)
      return metricsApi.interfaces(tenantId, deviceId, start, end, selectedInterface ?? undefined)
    },
    refetchInterval: shouldAutoRefresh(timeRange),
    enabled: active,
  })

  const handleCustomRangeChange = (start: string, end: string) => {
    setCustomStart(start)
    setCustomEnd(end)
  }

  // Group traffic data by interface name
  const byInterface = new Map<string, typeof trafficData>()
  if (trafficData) {
    for (const point of trafficData) {
      const key = point.interface
      if (!byInterface.has(key)) byInterface.set(key, [])
      byInterface.get(key)!.push(point)
    }
  }

  const interfaceNames = selectedInterface
    ? [selectedInterface]
    : [...byInterface.keys()]

  return (
    <div className="space-y-4 mt-4">
      {/* Controls row */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1">
          <TimeRangeSelector
            value={timeRange}
            onChange={setTimeRange}
            customStart={customStart}
            customEnd={customEnd}
            onCustomRangeChange={handleCustomRangeChange}
          />
        </div>

        {/* Interface filter */}
        {interfaces && interfaces.length > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-text-muted">Interface:</span>
            <select
              value={selectedInterface ?? ''}
              onChange={(e) => setSelectedInterface(e.target.value || null)}
              className="text-xs rounded border border-border bg-elevated/50 text-text-primary px-2 py-1 [color-scheme:dark]"
            >
              <option value="">All interfaces</option>
              {interfaces.map((iface) => (
                <option key={iface} value={iface}>
                  {iface}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Charts */}
      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-panel p-4 h-56 animate-pulse" />
          ))}
        </div>
      ) : !trafficData || trafficData.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-text-muted">
          {interfaces && interfaces.length === 0
            ? 'No interfaces discovered for this device.'
            : 'No traffic data available for the selected time range.'}
        </div>
      ) : (
        <div className="space-y-4">
          {interfaceNames.map((ifaceName) => {
            const ifaceData = byInterface.get(ifaceName) ?? []
            return (
              <div key={ifaceName} className="rounded-lg border border-border bg-panel p-4">
                <TrafficChart data={ifaceData} interfaceName={ifaceName} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
