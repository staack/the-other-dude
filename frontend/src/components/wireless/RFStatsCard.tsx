import { useQuery } from '@tanstack/react-query'
import { Radio } from 'lucide-react'
import { wirelessApi, type RFStatsResponse } from '@/lib/api'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/page-skeleton'

interface RFStatsCardProps {
  tenantId: string
  deviceId: string
  active: boolean
}

function StatValue({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="text-sm font-medium text-text-primary">
        {value != null ? `${value}${unit ?? ''}` : '--'}
      </span>
    </div>
  )
}

export function RFStatsCard({ tenantId, deviceId, active }: RFStatsCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['device-rf-stats', tenantId, deviceId],
    queryFn: () => wirelessApi.getDeviceRFStats(tenantId, deviceId),
    enabled: active,
  })

  if (isLoading) {
    return <TableSkeleton rows={2} />
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="No RF stats"
        description="No RF stats available for this device"
      />
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary px-1">RF Environment</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.items.map((stat: RFStatsResponse) => (
          <div
            key={stat.interface}
            className="rounded-lg border border-border bg-panel p-3"
          >
            <div className="flex items-center gap-2 mb-3">
              <Radio className="h-4 w-4 text-text-muted" />
              <span className="text-sm font-semibold text-text-primary">{stat.interface}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatValue label="Noise Floor" value={stat.noise_floor} unit=" dBm" />
              <StatValue label="Channel Width" value={stat.channel_width} unit=" MHz" />
              <StatValue label="TX Power" value={stat.tx_power} unit=" dBm" />
              <StatValue label="Clients" value={stat.registered_clients} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
