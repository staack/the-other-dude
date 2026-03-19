import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wifi } from 'lucide-react'
import { wirelessApi, type LinkResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DeviceLink } from '@/components/ui/device-link'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { signalColor } from './signal-color'

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

const STATE_STYLES: Record<string, string> = {
  active: 'bg-success/20 text-success border-success/40',
  degraded: 'bg-warning/20 text-warning border-warning/40',
  down: 'bg-error/20 text-error border-error/40',
  stale: 'bg-elevated text-text-muted border-border',
  discovered: 'bg-info/20 text-info border-info/40',
}

function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border',
        STATE_STYLES[state] ?? STATE_STYLES.stale,
      )}
    >
      {state}
    </span>
  )
}

interface WirelessLinksTableProps {
  tenantId: string
  siteId?: string
  stateFilter?: string
  showUnknownClients?: boolean
}

export function WirelessLinksTable({ tenantId, siteId }: WirelessLinksTableProps) {
  const [filter, setFilter] = useState<string>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['wireless-links', tenantId, siteId, filter],
    queryFn: () => {
      if (siteId) {
        return wirelessApi.getSiteLinks(tenantId, siteId)
      }
      const params = filter !== 'all' ? { state: filter } : undefined
      return wirelessApi.getLinks(tenantId, params)
    },
  })

  // Group links by AP device
  const grouped = useMemo(() => {
    if (!data?.items) return new Map<string, { apHostname: string; apDeviceId: string; links: LinkResponse[] }>()
    const map = new Map<string, { apHostname: string; apDeviceId: string; links: LinkResponse[] }>()
    for (const link of data.items) {
      const key = link.ap_device_id
      if (!map.has(key)) {
        map.set(key, {
          apHostname: link.ap_hostname ?? link.ap_device_id,
          apDeviceId: link.ap_device_id,
          links: [],
        })
      }
      map.get(key)!.links.push(link)
    }
    return map
  }, [data])

  if (isLoading) {
    return <TableSkeleton rows={8} />
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={Wifi}
        title="No wireless links"
        description="No wireless links discovered"
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">State:</span>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="down">Down</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-text-muted ml-2">
          {data.items.length} link{data.items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Links grouped by AP */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">
                  CPE
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
                <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-center">
                  State
                </th>
                <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                  Last Seen
                </th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.values()].map((group) => (
                <APGroup
                  key={group.apDeviceId}
                  tenantId={tenantId}
                  apHostname={group.apHostname}
                  apDeviceId={group.apDeviceId}
                  links={group.links}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function APGroup({
  tenantId,
  apHostname,
  apDeviceId,
  links,
}: {
  tenantId: string
  apHostname: string
  apDeviceId: string
  links: LinkResponse[]
}) {
  return (
    <>
      {/* AP header row */}
      <tr className="bg-elevated/50">
        <td colSpan={7} className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-text-muted" />
            <DeviceLink tenantId={tenantId} deviceId={apDeviceId} className="font-semibold text-text-primary">
              {apHostname}
            </DeviceLink>
            <span className="text-[10px] text-text-muted">
              ({links.length} client{links.length !== 1 ? 's' : ''})
            </span>
          </div>
        </td>
      </tr>
      {/* CPE rows */}
      {links.map((link) => (
        <tr
          key={link.id}
          className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
        >
          <td className="px-2 py-1.5 pl-6">
            <DeviceLink tenantId={tenantId} deviceId={link.cpe_device_id}>
              {link.cpe_hostname ?? link.client_mac}
            </DeviceLink>
          </td>
          <td className={cn('px-2 py-1.5 text-right font-medium', signalColor(link.signal_strength))}>
            {link.signal_strength != null ? `${link.signal_strength} dBm` : '--'}
          </td>
          <td className="px-2 py-1.5 text-right text-text-secondary">
            {link.tx_ccq != null ? `${link.tx_ccq}%` : '--'}
          </td>
          <td className="px-2 py-1.5 text-right text-text-secondary">
            {link.tx_rate ?? '--'}
          </td>
          <td className="px-2 py-1.5 text-right text-text-secondary">
            {link.rx_rate ?? '--'}
          </td>
          <td className="px-2 py-1.5 text-center">
            <StateBadge state={link.state} />
          </td>
          <td className="px-2 py-1.5 text-right text-text-muted text-xs">
            {timeAgo(link.last_seen)}
          </td>
        </tr>
      ))}
    </>
  )
}
