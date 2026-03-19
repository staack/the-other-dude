import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  sectorsApi,
  devicesApi,
  wirelessApi,
  type SectorResponse,
  type DeviceResponse,
  type LinkResponse,
} from '@/lib/api'
import { useAuth, canWrite, canDelete } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { signalColor } from '@/components/wireless/signal-color'
import { SectorFormDialog } from './SectorFormDialog'

interface SiteSectorViewProps {
  tenantId: string
  siteId: string
}

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    online: 'bg-online shadow-[0_0_6px_hsl(var(--online)/0.3)]',
    offline: 'bg-offline shadow-[0_0_6px_hsl(var(--offline)/0.3)]',
    unknown: 'bg-unknown',
  }
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', styles[status] ?? styles.unknown)}
      title={status}
    />
  )
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

export function SiteSectorView({ tenantId, siteId }: SiteSectorViewProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editSector, setEditSector] = useState<SectorResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SectorResponse | null>(null)

  const { data: sectorData, isLoading: sectorsLoading } = useQuery({
    queryKey: ['sectors', tenantId, siteId],
    queryFn: () => sectorsApi.list(tenantId, siteId),
  })

  const { data: deviceData, isLoading: devicesLoading } = useQuery({
    queryKey: ['site-devices', tenantId, siteId],
    queryFn: () => devicesApi.list(tenantId, { site_id: siteId, page_size: 100 }),
  })

  const { data: linksData } = useQuery({
    queryKey: ['site-links', tenantId, siteId],
    queryFn: () => wirelessApi.getSiteLinks(tenantId, siteId),
  })

  const deleteMutation = useMutation({
    mutationFn: (sectorId: string) => sectorsApi.delete(tenantId, siteId, sectorId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sectors', tenantId, siteId] })
      setDeleteTarget(null)
    },
  })

  const assignMutation = useMutation({
    mutationFn: ({ deviceId, sectorId }: { deviceId: string; sectorId: string | null }) =>
      sectorsApi.assignDevice(tenantId, deviceId, sectorId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-devices', tenantId, siteId] })
      void queryClient.invalidateQueries({ queryKey: ['sectors', tenantId, siteId] })
    },
  })

  // Group devices by sector_id
  const { sectorDevices, unassignedDevices } = useMemo(() => {
    const devices = deviceData?.items ?? []
    const grouped = new Map<string, DeviceResponse[]>()
    const unassigned: DeviceResponse[] = []

    for (const device of devices) {
      if (device.sector_id) {
        const list = grouped.get(device.sector_id) ?? []
        list.push(device)
        grouped.set(device.sector_id, list)
      } else {
        unassigned.push(device)
      }
    }
    return { sectorDevices: grouped, unassignedDevices: unassigned }
  }, [deviceData])

  // Build map of links by AP device ID
  const linksByAP = useMemo(() => {
    const map = new Map<string, LinkResponse[]>()
    if (linksData?.items) {
      for (const link of linksData.items) {
        const list = map.get(link.ap_device_id) ?? []
        list.push(link)
        map.set(link.ap_device_id, list)
      }
    }
    return map
  }, [linksData])

  if (sectorsLoading || devicesLoading) {
    return <TableSkeleton rows={6} />
  }

  const sectors = sectorData?.items ?? []
  const allSectorOptions = sectors.map((s) => ({ id: s.id, name: s.name }))

  if (sectors.length === 0 && unassignedDevices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center space-y-3">
        <p className="text-sm text-text-muted">
          No sectors defined. Create sectors to organize APs by direction.
        </p>
        {canWrite(user) && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Sector
          </Button>
        )}
        <SectorFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          tenantId={tenantId}
          siteId={siteId}
        />
      </div>
    )
  }

  function computeSectorStats(sectorId: string) {
    const devices = sectorDevices.get(sectorId) ?? []
    const deviceIds = new Set(devices.map((d) => d.id))
    let clientCount = 0
    let signalSum = 0
    let signalCount = 0
    let linkCount = 0

    for (const [apId, links] of linksByAP) {
      if (deviceIds.has(apId)) {
        for (const link of links) {
          clientCount++
          linkCount++
          if (link.signal_strength != null) {
            signalSum += link.signal_strength
            signalCount++
          }
        }
      }
    }

    return {
      clientCount,
      avgSignal: signalCount > 0 ? Math.round(signalSum / signalCount) : null,
      linkCount,
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">
          {sectors.length} Sector{sectors.length !== 1 ? 's' : ''}
        </h3>
        {canWrite(user) && (
          <Button size="sm" onClick={() => { setEditSector(null); setFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Add Sector
          </Button>
        )}
      </div>

      {/* Sector sections */}
      {sectors.map((sector) => (
        <SectorSection
          key={sector.id}
          sector={sector}
          tenantId={tenantId}
          devices={sectorDevices.get(sector.id) ?? []}
          linksByAP={linksByAP}
          stats={computeSectorStats(sector.id)}
          allSectors={allSectorOptions}
          user={user}
          onEdit={() => { setEditSector(sector); setFormOpen(true) }}
          onDelete={() => setDeleteTarget(sector)}
          onAssign={(deviceId, sectorId) => assignMutation.mutate({ deviceId, sectorId })}
        />
      ))}

      {/* Unassigned devices */}
      {unassignedDevices.length > 0 && (
        <SectorSection
          sector={null}
          tenantId={tenantId}
          devices={unassignedDevices}
          linksByAP={linksByAP}
          stats={{ clientCount: 0, avgSignal: null, linkCount: 0 }}
          allSectors={allSectorOptions}
          user={user}
          onEdit={() => {}}
          onDelete={() => {}}
          onAssign={(deviceId, sectorId) => assignMutation.mutate({ deviceId, sectorId })}
        />
      )}

      {/* Form dialog */}
      <SectorFormDialog
        key={editSector?.id ?? 'new'}
        open={formOpen}
        onOpenChange={setFormOpen}
        tenantId={tenantId}
        siteId={siteId}
        sector={editSector}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sector</DialogTitle>
            <DialogDescription>
              Delete sector &ldquo;{deleteTarget?.name}&rdquo;? Devices will be moved to unassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sector Section ──────────────────────────────────────────────────────────

interface SectorSectionProps {
  sector: SectorResponse | null
  tenantId: string
  devices: DeviceResponse[]
  linksByAP: Map<string, LinkResponse[]>
  stats: { clientCount: number; avgSignal: number | null; linkCount: number }
  allSectors: Array<{ id: string; name: string }>
  user: ReturnType<typeof useAuth>['user']
  onEdit: () => void
  onDelete: () => void
  onAssign: (deviceId: string, sectorId: string | null) => void
}

function SectorSection({
  sector,
  tenantId,
  devices,
  linksByAP,
  stats,
  allSectors,
  user,
  onEdit,
  onDelete,
  onAssign,
}: SectorSectionProps) {
  const [expanded, setExpanded] = useState(true)
  const isUnassigned = !sector

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Section header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-elevated/50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
        )}

        <span className="font-semibold text-sm text-text-primary">
          {isUnassigned ? 'Unassigned' : sector.name}
        </span>

        {!isUnassigned && sector.azimuth != null && (
          <Badge variant="secondary" className="text-[10px]">
            {sector.azimuth}&deg;
          </Badge>
        )}

        <span className="text-[10px] text-text-muted">
          {devices.length} device{devices.length !== 1 ? 's' : ''}
        </span>

        {!isUnassigned && (
          <span className="flex items-center gap-3 ml-auto text-[10px] text-text-muted">
            <span>{stats.clientCount} client{stats.clientCount !== 1 ? 's' : ''}</span>
            {stats.avgSignal != null && (
              <span className={signalColor(stats.avgSignal)}>
                avg {stats.avgSignal} dBm
              </span>
            )}
            <span>{stats.linkCount} link{stats.linkCount !== 1 ? 's' : ''}</span>
          </span>
        )}

        {/* Edit / Delete actions -- stop propagation to prevent toggle */}
        {!isUnassigned && (
          <span className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
            {canWrite(user) && (
              <button
                className="p-1 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
                onClick={onEdit}
                title="Edit sector"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {canDelete(user) && (
              <button
                className="p-1 rounded hover:bg-elevated text-text-muted hover:text-error transition-colors"
                onClick={onDelete}
                title="Delete sector"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border divide-y divide-border/50">
          {devices.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">
              No devices in this sector
            </div>
          ) : (
            devices.map((device) => (
              <APCard
                key={device.id}
                device={device}
                tenantId={tenantId}
                links={linksByAP.get(device.id) ?? []}
                allSectors={allSectors}
                currentSectorId={device.sector_id}
                user={user}
                onAssign={onAssign}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── AP Card ──────────────────────────────────────────────────────────────────

interface APCardProps {
  device: DeviceResponse
  tenantId: string
  links: LinkResponse[]
  allSectors: Array<{ id: string; name: string }>
  currentSectorId: string | null
  user: ReturnType<typeof useAuth>['user']
  onAssign: (deviceId: string, sectorId: string | null) => void
}

function APCard({ device, tenantId, links, allSectors, currentSectorId, user, onAssign }: APCardProps) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <StatusDot status={device.status} />
        <Link
          to="/tenants/$tenantId/devices/$deviceId"
          params={{ tenantId, deviceId: device.id }}
          className="font-semibold text-sm text-text-primary hover:text-accent transition-colors"
        >
          {device.hostname}
        </Link>

        {/* Sector assignment dropdown */}
        {canWrite(user) && (
          <div className="ml-auto">
            <Select
              value={currentSectorId ?? '__unassigned__'}
              onValueChange={(val) =>
                onAssign(device.id, val === '__unassigned__' ? null : val)
              }
            >
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="Assign sector" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
                {allSectors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Connected CPEs */}
      {links.length > 0 ? (
        <div className="ml-4 space-y-1">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-3 text-xs">
              <Link
                to="/tenants/$tenantId/devices/$deviceId"
                params={{ tenantId, deviceId: link.cpe_device_id }}
                className="text-text-primary hover:text-accent transition-colors truncate min-w-0"
              >
                {link.cpe_hostname ?? link.client_mac}
              </Link>
              <span className={cn('font-medium', signalColor(link.signal_strength))}>
                {link.signal_strength != null ? `${link.signal_strength} dBm` : '--'}
              </span>
              <span className="text-text-secondary">
                {link.tx_ccq != null ? `${link.tx_ccq}%` : '--'}
              </span>
              <StateBadge state={link.state} />
            </div>
          ))}
        </div>
      ) : (
        <p className="ml-4 text-xs text-text-muted">No connected clients</p>
      )}
    </div>
  )
}
