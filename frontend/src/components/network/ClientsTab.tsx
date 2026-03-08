/**
 * ClientsTab -- Connected client device table with ARP/DHCP merge and
 * expandable wireless detail rows.
 *
 * Displays all client devices discovered on a MikroTik device via ARP + DHCP +
 * wireless registration tables. Supports column sorting, text search filtering,
 * and expandable rows for wireless clients showing signal/tx/rx/uptime.
 *
 * Props follow the active-guard pattern: data is only fetched when `active`
 * is true (i.e. the tab is visible). Auto-refreshes every 30 seconds.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search,
  Wifi,
  Cable,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Signal,
  Users,
  RefreshCw,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { cn } from '@/lib/utils'
import { networkApi, type ClientDevice } from '@/lib/networkApi'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientsTabProps {
  tenantId: string
  deviceId: string
  /** Active guard -- only fetch when the tab is visible */
  active: boolean
}

type SortField = 'ip' | 'mac' | 'hostname' | 'interface' | 'status'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Signal strength helpers
// ---------------------------------------------------------------------------

function parseSignalDbm(signal: string | null): number | null {
  if (!signal) return null
  // RouterOS formats signal as e.g. "-65dBm" or "-65"
  const match = signal.match(/-?\d+/)
  return match ? parseInt(match[0], 10) : null
}

function signalColor(dbm: number): string {
  if (dbm > -65) return 'text-success'
  if (dbm >= -75) return 'text-warning'
  return 'text-error'
}

function signalLabel(dbm: number): string {
  if (dbm > -65) return 'Good'
  if (dbm >= -75) return 'Fair'
  return 'Poor'
}

// ---------------------------------------------------------------------------
// Sort icon helper
// ---------------------------------------------------------------------------

function SortIcon({ field, currentField, currentDir }: {
  field: SortField
  currentField: SortField
  currentDir: SortDir
}) {
  if (field !== currentField) {
    return <ArrowUpDown className="ml-1 h-3 w-3 text-text-muted" />
  }
  return currentDir === 'asc'
    ? <ArrowUp className="ml-1 h-3 w-3 text-accent" />
    : <ArrowDown className="ml-1 h-3 w-3 text-accent" />
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientsTab({ tenantId, deviceId, active }: ClientsTabProps) {
  const [sortField, setSortField] = useState<SortField>('ip')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedMac, setExpandedMac] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['clients', tenantId, deviceId],
    queryFn: () => networkApi.getClients(tenantId, deviceId),
    enabled: active,
    refetchInterval: 30_000,
  })

  // Toggle sort: if same column, flip direction; otherwise set new column ascending
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const getAriaSort = (field: SortField): 'ascending' | 'descending' | 'none' => {
    if (field !== sortField) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  // Filter and sort the client list
  const clients = useMemo(() => {
    if (!data?.clients) return []

    const query = searchQuery.toLowerCase().trim()

    // Filter by search query
    const filtered = query
      ? data.clients.filter(
          (c) =>
            c.ip.toLowerCase().includes(query) ||
            c.mac.toLowerCase().includes(query) ||
            (c.hostname && c.hostname.toLowerCase().includes(query)),
        )
      : data.clients

    // Sort
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'ip': {
          // Numeric IP sort
          const aParts = a.ip.split('.').map(Number)
          const bParts = b.ip.split('.').map(Number)
          for (let i = 0; i < 4; i++) {
            cmp = (aParts[i] || 0) - (bParts[i] || 0)
            if (cmp !== 0) break
          }
          break
        }
        case 'mac':
          cmp = a.mac.localeCompare(b.mac)
          break
        case 'hostname':
          cmp = (a.hostname || '').localeCompare(b.hostname || '')
          break
        case 'interface':
          cmp = a.interface.localeCompare(b.interface)
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data?.clients, searchQuery, sortField, sortDir])

  // Stats
  const totalClients = data?.clients.length ?? 0
  const wirelessCount = data?.clients.filter((c) => c.is_wireless).length ?? 0
  const reachableCount = data?.clients.filter((c) => c.status === 'reachable').length ?? 0

  // Loading state
  if (isLoading) {
    return <TableSkeleton rows={8} />
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <p className="text-sm">Failed to load client devices</p>
        <p className="text-xs mt-1">{(error as Error)?.message || 'Unknown error'}</p>
        <button
          onClick={() => refetch()}
          className="mt-3 text-xs text-accent hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search bar and stats row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <Input
            placeholder="Search by IP, MAC, or hostname..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <Badge className="gap-1">
            <Users className="h-3 w-3" />
            {totalClients} clients
          </Badge>
          <Badge className="gap-1">
            <Wifi className="h-3 w-3" />
            {wirelessCount} wireless
          </Badge>
          <Badge className="gap-1">
            <span className="h-2 w-2 rounded-full bg-success inline-block" />
            {reachableCount} reachable
          </Badge>

          <button
            onClick={() => refetch()}
            className="ml-2 p-1 rounded hover:bg-elevated transition-colors"
            title="Refresh client list"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-text-muted', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {clients.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <Users className="h-10 w-10 mb-2 opacity-40" />
          <p className="text-sm font-medium">No clients found</p>
          <p className="text-xs mt-1">
            {searchQuery
              ? 'No clients match your search query'
              : 'No connected client devices detected on this device'}
          </p>
        </div>
      )}

      {/* Client table */}
      {clients.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-text-secondary text-left">
                {/* Expand chevron column */}
                <th className="w-8 px-3 py-2.5" />

                <th className="px-3 py-2.5 w-16">Status</th>

                <th
                  className="px-3 py-2.5 cursor-pointer select-none hover:text-text-primary transition-colors"
                  onClick={() => handleSort('ip')}
                  aria-sort={getAriaSort('ip')}
                >
                  <span className="inline-flex items-center">
                    IP Address
                    <SortIcon field="ip" currentField={sortField} currentDir={sortDir} />
                  </span>
                </th>

                <th
                  className="px-3 py-2.5 cursor-pointer select-none hover:text-text-primary transition-colors"
                  onClick={() => handleSort('mac')}
                  aria-sort={getAriaSort('mac')}
                >
                  <span className="inline-flex items-center">
                    MAC Address
                    <SortIcon field="mac" currentField={sortField} currentDir={sortDir} />
                  </span>
                </th>

                <th
                  className="px-3 py-2.5 cursor-pointer select-none hover:text-text-primary transition-colors"
                  onClick={() => handleSort('hostname')}
                  aria-sort={getAriaSort('hostname')}
                >
                  <span className="inline-flex items-center">
                    Hostname
                    <SortIcon field="hostname" currentField={sortField} currentDir={sortDir} />
                  </span>
                </th>

                <th
                  className="px-3 py-2.5 cursor-pointer select-none hover:text-text-primary transition-colors"
                  onClick={() => handleSort('interface')}
                  aria-sort={getAriaSort('interface')}
                >
                  <span className="inline-flex items-center">
                    Interface
                    <SortIcon field="interface" currentField={sortField} currentDir={sortDir} />
                  </span>
                </th>

                <th className="px-3 py-2.5">Type</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const isExpanded = expandedMac === client.mac
                const canExpand = client.is_wireless

                return (
                  <ClientRow
                    key={client.mac}
                    client={client}
                    isExpanded={isExpanded}
                    canExpand={canExpand}
                    onToggle={() => setExpandedMac(isExpanded ? null : client.mac)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Last updated timestamp */}
      {data?.timestamp && (
        <p className="text-xs text-text-muted text-right">
          Last updated: {new Date(data.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Client row sub-component
// ---------------------------------------------------------------------------

function ClientRow({
  client,
  isExpanded,
  canExpand,
  onToggle,
}: {
  client: ClientDevice
  isExpanded: boolean
  canExpand: boolean
  onToggle: () => void
}) {
  const dbm = parseSignalDbm(client.signal_strength)

  return (
    <>
      <tr
        className={cn(
          'border-t border-border hover:bg-elevated/50 transition-colors',
          canExpand && 'cursor-pointer',
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        {/* Expand chevron */}
        <td className="px-3 py-2.5">
          {canExpand && (
            isExpanded
              ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
              : <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
          )}
        </td>

        {/* Status dot */}
        <td className="px-3 py-2.5">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              client.status === 'reachable' ? 'bg-success' : 'bg-text-muted',
            )}
            title={client.status}
          />
        </td>

        {/* IP */}
        <td className="px-3 py-2.5 font-mono text-xs">{client.ip}</td>

        {/* MAC */}
        <td className="px-3 py-2.5 font-mono text-xs text-text-secondary">{client.mac}</td>

        {/* Hostname */}
        <td className="px-3 py-2.5">
          {client.hostname ? (
            <span className="text-text-primary">{client.hostname}</span>
          ) : (
            <span className="text-text-muted">&mdash;</span>
          )}
        </td>

        {/* Interface */}
        <td className="px-3 py-2.5 text-text-secondary">{client.interface || '\u2014'}</td>

        {/* Type badge */}
        <td className="px-3 py-2.5">
          {client.is_wireless ? (
            <Badge className="gap-1 bg-accent/10 text-accent border-accent/30">
              <Wifi className="h-3 w-3" />
              WiFi
            </Badge>
          ) : (
            <Badge className="gap-1">
              <Cable className="h-3 w-3" />
              Wired
            </Badge>
          )}
        </td>
      </tr>

      {/* Expanded wireless detail row */}
      {isExpanded && canExpand && (
        <tr className="border-t border-border/50 bg-elevated/30">
          <td colSpan={7} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              {/* Signal strength */}
              <div>
                <span className="text-text-muted block mb-0.5">Signal Strength</span>
                {dbm !== null ? (
                  <span className={cn('font-medium flex items-center gap-1', signalColor(dbm))}>
                    <Signal className="h-3.5 w-3.5" />
                    {client.signal_strength} ({signalLabel(dbm)})
                  </span>
                ) : (
                  <span className="text-text-muted">&mdash;</span>
                )}
              </div>

              {/* TX Rate */}
              <div>
                <span className="text-text-muted block mb-0.5">TX Rate</span>
                <span className="font-medium text-text-primary">
                  {client.tx_rate || '\u2014'}
                </span>
              </div>

              {/* RX Rate */}
              <div>
                <span className="text-text-muted block mb-0.5">RX Rate</span>
                <span className="font-medium text-text-primary">
                  {client.rx_rate || '\u2014'}
                </span>
              </div>

              {/* Uptime */}
              <div>
                <span className="text-text-muted block mb-0.5">Uptime</span>
                <span className="font-medium text-text-primary">
                  {client.uptime || '\u2014'}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
