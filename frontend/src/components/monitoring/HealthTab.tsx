import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { metricsApi } from '@/lib/api'
import { TimeRangeSelector, getTimeRange, shouldAutoRefresh } from './TimeRangeSelector'
import { HealthChart } from './HealthChart'

interface HealthTabProps {
  tenantId: string
  deviceId: string
  active?: boolean
}

export function HealthTab({ tenantId, deviceId, active = true }: HealthTabProps) {
  const [timeRange, setTimeRange] = useState('6h')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['metrics', 'health', deviceId, timeRange, customStart, customEnd],
    queryFn: () => {
      const { start, end } = getTimeRange(timeRange, customStart, customEnd)
      return metricsApi.health(tenantId, deviceId, start, end)
    },
    refetchInterval: shouldAutoRefresh(timeRange),
    enabled: active,
  })

  const handleCustomRangeChange = (start: string, end: string) => {
    setCustomStart(start)
    setCustomEnd(end)
  }

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-panel p-4 h-44 animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-text-muted">
          No health metrics data available for the selected time range.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-panel p-4">
            <HealthChart
              data={data}
              metric="avg_cpu"
              label="CPU Load"
              color="#38BDF8"
              unit="%"
              maxY={100}
            />
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <HealthChart
              data={data}
              metric="avg_mem_pct"
              label="Memory Usage"
              color="#4ADE80"
              unit="%"
              maxY={100}
            />
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <HealthChart
              data={data}
              metric="avg_disk_pct"
              label="Disk Usage"
              color="#FBBF24"
              unit="%"
              maxY={100}
            />
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <HealthChart
              data={data}
              metric="avg_temp"
              label="Temperature"
              color="#F87171"
              unit="C"
            />
          </div>
        </div>
      )}
    </div>
  )
}
