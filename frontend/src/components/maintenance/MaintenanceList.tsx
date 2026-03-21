/**
 * MaintenanceList -- Three-section layout showing active, upcoming, and past
 * maintenance windows with create/edit/delete actions.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  Plus,
  Pencil,
  Trash2,
  BellOff,
  Bell,
  Monitor,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { maintenanceApi, type MaintenanceWindow } from '@/lib/api'
import { MaintenanceForm } from './MaintenanceForm'

interface MaintenanceListProps {
  tenantId: string
}

export function MaintenanceList({ tenantId }: MaintenanceListProps) {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editWindow, setEditWindow] = useState<MaintenanceWindow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MaintenanceWindow | null>(null)

  const { data: windows, isLoading } = useQuery({
    queryKey: ['maintenance-windows', tenantId],
    queryFn: () => maintenanceApi.list(tenantId),
    enabled: !!tenantId,
  })

  const deleteMutation = useMutation({
    mutationFn: (windowId: string) => maintenanceApi.delete(tenantId, windowId),
    onSuccess: () => {
      toast({ title: 'Maintenance window deleted' })
      queryClient.invalidateQueries({ queryKey: ['maintenance-windows', tenantId] })
      setDeleteTarget(null)
    },
    onError: () => {
      toast({ title: 'Failed to delete maintenance window', variant: 'destructive' })
    },
  })

  const now = new Date()

  const active = (windows ?? []).filter(
    (w) => new Date(w.start_at) <= now && new Date(w.end_at) >= now,
  )
  const upcoming = (windows ?? []).filter((w) => new Date(w.start_at) > now)
  const past = (windows ?? [])
    .filter((w) => new Date(w.end_at) < now)
    .slice(0, 20)

  function openEdit(w: MaintenanceWindow) {
    setEditWindow(w)
    setFormOpen(true)
  }

  function openCreate() {
    setEditWindow(null)
    setFormOpen(true)
  }

  function formatRange(startAt: string, endAt: string): string {
    const start = new Date(startAt)
    const end = new Date(endAt)
    const opts: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
    return `${start.toLocaleDateString(undefined, opts)} - ${end.toLocaleDateString(undefined, opts)}`
  }

  function formatDuration(startAt: string, endAt: string): string {
    const ms = new Date(endAt).getTime() - new Date(startAt).getTime()
    const hours = Math.floor(ms / 3600000)
    const mins = Math.floor((ms % 3600000) / 60000)
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  if (isLoading) {
    return (
      <div className="py-8 text-center">
        <span className="text-[9px] text-text-muted">Loading&hellip;</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {(windows ?? []).length} maintenance window{(windows ?? []).length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New Window
        </Button>
      </div>

      {/* Active */}
      {active.length > 0 && (
        <Section title="Active" count={active.length} color="border-l-success">
          {active.map((w) => (
            <WindowCard
              key={w.id}
              window={w}
              variant="active"
              onEdit={() => openEdit(w)}
              onDelete={() => setDeleteTarget(w)}
              formatRange={formatRange}
              formatDuration={formatDuration}
            />
          ))}
        </Section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Section title="Upcoming" count={upcoming.length} color="border-l-warning">
          {upcoming.map((w) => (
            <WindowCard
              key={w.id}
              window={w}
              variant="upcoming"
              onEdit={() => openEdit(w)}
              onDelete={() => setDeleteTarget(w)}
              formatRange={formatRange}
              formatDuration={formatDuration}
            />
          ))}
        </Section>
      )}

      {/* Past */}
      {past.length > 0 && (
        <Section title="Past" count={past.length} color="border-l-border">
          {past.map((w) => (
            <WindowCard
              key={w.id}
              window={w}
              variant="past"
              onEdit={() => openEdit(w)}
              onDelete={() => setDeleteTarget(w)}
              formatRange={formatRange}
              formatDuration={formatDuration}
            />
          ))}
        </Section>
      )}

      {/* Empty state */}
      {(windows ?? []).length === 0 && (
        <EmptyState
          icon={Calendar}
          title="No maintenance windows"
          description="Schedule maintenance windows to suppress alerts during planned work."
          action={{ label: 'Create Window', onClick: openCreate }}
        />
      )}

      {/* Form dialog */}
      <MaintenanceForm
        tenantId={tenantId}
        open={formOpen}
        onOpenChange={setFormOpen}
        editWindow={editWindow}
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Maintenance Window</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({
  title,
  count,
  color,
  children,
}: {
  title: string
  count: number
  color: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
        {title}{' '}
        <span className="text-text-muted/60">({count})</span>
      </h3>
      <div className={`space-y-2 border-l-2 ${color} pl-3`}>{children}</div>
    </div>
  )
}

function WindowCard({
  window: w,
  variant,
  onEdit,
  onDelete,
  formatRange,
  formatDuration,
}: {
  window: MaintenanceWindow
  variant: 'active' | 'upcoming' | 'past'
  onEdit: () => void
  onDelete: () => void
  formatRange: (s: string, e: string) => string
  formatDuration: (s: string, e: string) => string
}) {
  const isPast = variant === 'past'

  return (
    <div
      className={`rounded-lg border border-border bg-panel p-3 ${
        isPast ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {variant === 'active' && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
            )}
            <span className="text-sm font-medium text-text-primary truncate">
              {w.name}
            </span>
          </div>

          <p className="text-xs text-text-muted mb-1.5">
            {formatRange(w.start_at, w.end_at)}{' '}
            <span className="text-text-muted/60">
              ({formatDuration(w.start_at, w.end_at)})
            </span>
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Device count */}
            <Badge variant="outline" className="text-[10px] gap-1">
              <Monitor className="h-3 w-3" />
              {w.device_ids.length === 0
                ? 'All Devices'
                : `${w.device_ids.length} device${w.device_ids.length !== 1 ? 's' : ''}`}
            </Badge>

            {/* Suppress status */}
            {w.suppress_alerts ? (
              <Badge variant="outline" className="text-[10px] gap-1 text-warning">
                <BellOff className="h-3 w-3" />
                Alerts Suppressed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1 text-text-muted">
                <Bell className="h-3 w-3" />
                Alerts Active
              </Badge>
            )}
          </div>

          {w.notes && (
            <p className="text-xs text-text-muted mt-1.5 line-clamp-1">{w.notes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-elevated/50 transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
