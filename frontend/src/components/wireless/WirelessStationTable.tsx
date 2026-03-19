import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wifi } from 'lucide-react'
import { wirelessApi, type RegistrationResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DeviceLink } from '@/components/ui/device-link'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { signalColor } from './signal-color'
import { SignalHistoryChart } from './SignalHistoryChart'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function ccqColor(ccq: number | null): string {
  if (ccq == null) return 'text-text-muted'
  if (ccq >= 80) return 'text-success'
  if (ccq >= 60) return 'text-warning'
  return 'text-error'
}

interface WirelessStationTableProps {
  tenantId: string
  deviceId: string
  active: boolean
}

export function WirelessStationTable({ tenantId, deviceId, active }: WirelessStationTableProps) {
  const [expandedMac, setExpandedMac] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['device-registrations', tenantId, deviceId],
    queryFn: () => wirelessApi.getDeviceRegistrations(tenantId, deviceId),
    enabled: active,
    refetchInterval: active ? 60_000 : false,
  })

  if (isLoading) {
    return <TableSkeleton rows={5} />
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={Wifi}
        title="No wireless clients"
        description="No wireless clients connected to this device"
      />
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-elevated/30">
        <h3 className="text-sm font-semibold text-text-primary">
          Wireless Stations ({data.items.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">
                MAC
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">
                Hostname
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                Signal
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                CCQ
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                TX Rate
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                RX Rate
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                Distance
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                Uptime
              </th>
              <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                Last Seen
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((reg: RegistrationResponse) => (
              <React.Fragment key={reg.mac_address}>
                <tr
                  className="border-b border-border/50 hover:bg-elevated/50 transition-colors cursor-pointer"
                  onClick={() => setExpandedMac(expandedMac === reg.mac_address ? null : reg.mac_address)}
                >
                  <td className="px-2 py-1.5 font-mono text-xs text-text-secondary">
                    {reg.mac_address}
                  </td>
                  <td className="px-2 py-1.5 text-text-primary">
                    {reg.device_id ? (
                      <DeviceLink tenantId={tenantId} deviceId={reg.device_id}>
                        {reg.hostname ?? reg.mac_address}
                      </DeviceLink>
                    ) : (
                      <span className="text-text-muted">{reg.hostname ?? '--'}</span>
                    )}
                  </td>
                  <td className={cn('px-2 py-1.5 text-right font-medium', signalColor(reg.signal_strength))}>
                    {reg.signal_strength != null ? `${reg.signal_strength} dBm` : '--'}
                  </td>
                  <td className={cn('px-2 py-1.5 text-right font-medium', ccqColor(reg.tx_ccq))}>
                    {reg.tx_ccq != null ? `${reg.tx_ccq}%` : '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {reg.tx_rate ?? '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {reg.rx_rate ?? '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {reg.distance != null ? `${reg.distance}m` : '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {reg.uptime ?? '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-muted text-xs">
                    {timeAgo(reg.last_seen)}
                  </td>
                </tr>
                {expandedMac === reg.mac_address && (
                  <tr>
                    <td colSpan={9} className="px-3 py-3 bg-elevated/20">
                      <SignalHistoryChart
                        tenantId={tenantId}
                        deviceId={deviceId}
                        macAddress={reg.mac_address}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
