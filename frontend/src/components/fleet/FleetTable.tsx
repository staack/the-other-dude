import { useRef, useState, useCallback } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown, ChevronsUpDown, Monitor, MapPin } from 'lucide-react'
import { devicesApi, sitesApi, type DeviceResponse } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { useShortcut } from '@/hooks/useShortcut'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { formatUptime, formatDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DeviceLink } from '@/components/ui/device-link'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'

interface FleetTableProps {
  tenantId: string
  search?: string
  status?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

type SortDir = 'asc' | 'desc'

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    online: 'bg-online shadow-[0_0_6px_hsl(var(--online)/0.3)]',
    offline: 'bg-offline shadow-[0_0_6px_hsl(var(--offline)/0.3)]',
    unknown: 'bg-unknown',
  }
  return (
    <span
      className={cn('inline-block w-[5px] h-[5px] rounded-full flex-shrink-0', styles[status] ?? styles.unknown)}
      title={status}
    />
  )
}

interface SortHeaderProps {
  column: string
  label: string
  currentSort: string
  currentDir: SortDir
  onSort: (col: string) => void
  className?: string
}

function SortHeader({ column, label, currentSort, currentDir, onSort, className }: SortHeaderProps) {
  const isActive = currentSort === column
  const ariaSortValue: 'ascending' | 'descending' | 'none' = isActive
    ? (currentDir === 'asc' ? 'ascending' : 'descending')
    : 'none'

  return (
    <th scope="col" className={cn('px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted', className)} aria-sort={ariaSortValue}>
      <button
        className="flex items-center gap-1 hover:text-text-primary transition-colors group"
        onClick={() => onSort(column)}
        data-testid={`sort-${column}`}
      >
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ChevronUp className="h-3 w-3 text-text-secondary" />
          ) : (
            <ChevronDown className="h-3 w-3 text-text-secondary" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 text-text-muted group-hover:text-text-secondary" />
        )}
      </button>
    </th>
  )
}

function DeviceCard({ device, tenantId }: { device: DeviceResponse; tenantId: string }) {
  return (
    <div
      className="w-full text-left rounded-lg border border-border bg-surface p-3 hover:bg-elevated/50 transition-colors min-h-[44px]"
      data-testid={`device-card-${device.hostname}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={device.status} />
          <DeviceLink tenantId={tenantId} deviceId={device.id} className="font-medium text-sm text-text-primary truncate">{device.hostname}</DeviceLink>
        </div>
        <span className="text-xs text-text-muted shrink-0">{formatUptime(device.uptime_seconds)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-xs text-text-secondary">
        <span className="font-mono">{device.ip_address}</span>
        {device.model && <span>{device.model}</span>}
        {device.routeros_version && <span>v{device.routeros_version}</span>}
      </div>
      {device.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {device.tags.map((tag) => (
            <Badge key={tag.id} color={tag.color} className="text-[10px]">{tag.name}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

const VIRTUAL_SCROLL_THRESHOLD = 100
const VIRTUAL_ROW_HEIGHT = 48
const VIRTUAL_OVERSCAN = 10

export function FleetTable({
  tenantId,
  search,
  status,
  sortBy = 'hostname',
  sortDir = 'asc',
  page = 1,
  pageSize = 25,
}: FleetTableProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkSiteId, setBulkSiteId] = useState<string>('')

  const { data: sitesData } = useQuery({
    queryKey: ['sites', tenantId],
    queryFn: () => sitesApi.list(tenantId),
  })

  const bulkAssignMutation = useMutation({
    mutationFn: ({ siteId, deviceIds }: { siteId: string; deviceIds: string[] }) =>
      sitesApi.bulkAssign(tenantId, siteId, deviceIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
      setSelectedIds(new Set())
      setBulkAssignOpen(false)
      setBulkSiteId('')
    },
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['devices', tenantId, { search, status, sortBy, sortDir, page, pageSize }],
    queryFn: () =>
      devicesApi.list(tenantId, {
        search,
        status,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
      }),
    placeholderData: (prev) => prev,
  })

  const updateSearch = (updates: Record<string, string | number | undefined>) => {
    void navigate({
      to: '/tenants/$tenantId/devices',
      params: { tenantId },
      search: (prev) => ({ ...prev, ...updates }),
    })
  }

  const handleSort = (col: string) => {
    const newDir: SortDir =
      col === sortBy ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    updateSearch({ sort_by: col, sort_dir: newDir, page: 1 })
  }

  const handleDeviceClick = (device: DeviceResponse) => {
    void navigate({
      to: '/tenants/$tenantId/devices/$deviceId',
      params: { tenantId, deviceId: device.id },
    })
  }

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 0
  const startItem = data ? (data.page - 1) * data.page_size + 1 : 0
  const endItem = data ? Math.min(data.page * data.page_size, data.total) : 0

  const sortProps = { currentSort: sortBy, currentDir: sortDir as SortDir, onSort: handleSort }

  const items = data?.items ?? []
  const useVirtual = items.length > VIRTUAL_SCROLL_THRESHOLD
  const [selectedIndex, setSelectedIndex] = useState(-1)

  // j/k/Enter keyboard navigation for device list
  const hasItems = items.length > 0
  useShortcut(
    'j',
    useCallback(() => {
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
    }, [items.length]),
    hasItems,
  )
  useShortcut(
    'k',
    useCallback(() => {
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    }, []),
    hasItems,
  )
  useShortcut(
    'Enter',
    useCallback(() => {
      if (selectedIndex >= 0 && selectedIndex < items.length) {
        handleDeviceClick(items[selectedIndex])
      }
    }, [selectedIndex, items]),
    hasItems && selectedIndex >= 0,
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    enabled: useVirtual,
  })

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((d) => d.id)))
    }
  }

  function renderDeviceRow(device: DeviceResponse) {
    return (
      <>
        <td className="px-2 py-1.5 text-center w-8">
          <input
            type="checkbox"
            checked={selectedIds.has(device.id)}
            onChange={() => toggleSelection(device.id)}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
            onClick={(e) => e.stopPropagation()}
          />
        </td>
        <td className="px-2 py-1.5 text-center">
          <StatusDot status={device.status} />
        </td>
        <td className="px-2 py-1.5 font-medium text-text-primary"><DeviceLink tenantId={tenantId} deviceId={device.id}>{device.hostname}</DeviceLink></td>
        <td className="px-2 py-1.5 font-mono text-xs text-text-secondary">
          {device.ip_address}
        </td>
        <td className="px-2 py-1.5 text-text-muted">{device.model ?? '—'}</td>
        <td className="px-2 py-1.5 text-text-secondary">
          {device.site_id ? (
            <Link
              to="/tenants/$tenantId/sites/$siteId"
              params={{ tenantId, siteId: device.site_id }}
              className="text-text-secondary hover:text-text-primary transition-colors text-xs truncate max-w-[120px] inline-block"
            >
              {device.site_name}
            </Link>
          ) : (
            <span className="text-text-muted text-xs">--</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-text-secondary">
          {device.routeros_version ?? '—'}
        </td>
        <td className="px-2 py-1.5 text-text-secondary">
          {device.firmware_version || '—'}
        </td>
        <td className="px-2 py-1.5 text-right text-text-secondary">
          {formatUptime(device.uptime_seconds)}
        </td>
        <td className="px-2 py-1.5 text-xs text-text-muted">
          {formatDateTime(device.last_seen)}
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1">
            {device.tags.map((tag) => (
              <Badge key={tag.id} color={tag.color} className="text-xs">
                {tag.name}
              </Badge>
            ))}
          </div>
        </td>
      </>
    )
  }

  const tableHead = (
    <thead>
      <tr className="border-b border-border">
        <th scope="col" className="px-2 py-2 w-8">
          <input
            type="checkbox"
            checked={selectedIds.size === items.length && items.length > 0}
            onChange={toggleSelectAll}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
          />
        </th>
        <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted w-6"><span className="sr-only">Status</span></th>
        <SortHeader column="hostname" label="Hostname" {...sortProps} className="text-left" />
        <SortHeader column="ip_address" label="IP" {...sortProps} className="text-left" />
        <SortHeader column="model" label="Model" {...sortProps} className="text-left" />
        <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">Site</th>
        <SortHeader column="routeros_version" label="RouterOS" {...sortProps} className="text-left" />
        <SortHeader column="firmware_version" label="Firmware" {...sortProps} className="text-left" />
        <SortHeader column="uptime_seconds" label="Uptime" {...sortProps} className="text-right" />
        <SortHeader column="last_seen" label="Last Seen" {...sortProps} className="text-left" />
        <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">Tags</th>
      </tr>
    </thead>
  )

  return (
    <div className="space-y-2" data-testid="fleet-table">
      {/* Mobile card view (below lg:) */}
      <div className={cn(
        'lg:hidden space-y-2',
        isFetching && !isLoading && 'opacity-70',
      )}>
        {isLoading ? (
          <TableSkeleton rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Monitor}
            title="No devices yet"
            description="Add your first device to start monitoring your network."
            action={{
              label: 'Add Device',
              onClick: () => void navigate({
                to: '/tenants/$tenantId/devices',
                params: { tenantId },
                search: { add: 'true' },
              }),
            }}
          />
        ) : (
          items.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              tenantId={tenantId}
            />
          ))
        )}
      </div>

      {/* Desktop table view (lg: and above) */}
      <div
        className={cn(
          'hidden lg:block rounded-lg border border-border overflow-hidden transition-opacity',
          isFetching && !isLoading && 'opacity-70',
        )}
      >
        {useVirtual ? (
          /* Virtual scrolling for large lists (>100 items) */
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <table className="w-full text-sm">
                {tableHead}
              </table>
              <div
                ref={scrollContainerRef}
                className="max-h-[calc(100vh-300px)] overflow-y-auto"
              >
                <div
                  style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
                >
                  <table className="w-full text-sm">
                    <tbody>
                      {virtualizer.getVirtualItems().map((virtualRow) => {
                        const device = items[virtualRow.index]
                        return (
                          <tr
                            key={device.id}
                            data-index={virtualRow.index}
                            ref={virtualizer.measureElement}
                            className={cn(
                              'border-b border-border/50 hover:bg-elevated/50 transition-colors',
                              selectedIndex === virtualRow.index && 'bg-elevated/50',
                            )}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {renderDeviceRow(device)}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Standard table for small lists (<=100 items) */
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              {tableHead}
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-4">
                      <TableSkeleton />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={11}>
                      <EmptyState
                        icon={Monitor}
                        title="No devices yet"
                        description="Add your first device to start monitoring your network."
                        action={{
                          label: 'Add Device',
                          onClick: () => void navigate({
                            to: '/tenants/$tenantId/devices',
                            params: { tenantId },
                            search: { add: 'true' },
                          }),
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((device, idx) => (
                    <tr
                      key={device.id}
                      data-testid={`device-row-${device.hostname}`}
                      className={cn(
                        'border-b border-border/50 hover:bg-elevated/50 transition-colors',
                        selectedIndex === idx && 'bg-elevated/50',
                      )}
                    >
                      {renderDeviceRow(device)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk assign action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated p-3">
          <span className="text-sm text-text-secondary">{selectedIds.size} device{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkAssignOpen(true)}>
            <MapPin className="h-3.5 w-3.5 mr-1" /> Assign to site
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Bulk assign dialog */}
      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {selectedIds.size} device{selectedIds.size !== 1 ? 's' : ''} to site</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <Select value={bulkSiteId} onValueChange={setBulkSiteId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select a site..." />
              </SelectTrigger>
              <SelectContent>
                {sitesData?.sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkAssignOpen(false)}>Cancel</Button>
              <Button
                disabled={!bulkSiteId || bulkAssignMutation.isPending}
                onClick={() => bulkAssignMutation.mutate({ siteId: bulkSiteId, deviceIds: Array.from(selectedIds) })}
              >
                {bulkAssignMutation.isPending ? 'Assigning...' : 'Assign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pagination (shown for both views) */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Showing {startItem}–{endItem} of {data.total} device{data.total !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-3">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => updateSearch({ page_size: parseInt(v), page: 1 })}
            >
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
                <SelectItem value="250">250 / page</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateSearch({ page: page - 1 })}
                disabled={page <= 1}
                className="h-7 px-2"
                data-testid="pagination-prev"
              >
                Prev
              </Button>
              <span className="px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateSearch({ page: page + 1 })}
                disabled={page >= totalPages}
                className="h-7 px-2"
                data-testid="pagination-next"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
