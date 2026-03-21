/**
 * RoutesPanel -- IP route management panel for device configuration.
 *
 * Displays routes from /ip/route with filter tabs (All/Static/Connected/Dynamic),
 * add/edit/delete dialogs with CIDR validation, and safe apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { SafetyToggle } from './SafetyToggle'
import { ChangePreviewModal } from './ChangePreviewModal'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'static' | 'connected' | 'dynamic'

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'static', label: 'Static' },
  { key: 'connected', label: 'Connected' },
  { key: 'dynamic', label: 'Dynamic' },
]

// ---------------------------------------------------------------------------
// Entry & form types
// ---------------------------------------------------------------------------

interface RouteEntry {
  '.id': string
  'dst-address': string
  gateway: string
  distance: string
  'routing-mark': string
  interface: string
  active: string
  dynamic: string
  static: string
  connect: string
  disabled: string
  [key: string]: string
}

interface RouteForm {
  'dst-address': string
  gateway: string
  distance: string
  'routing-mark': string
}

const EMPTY_FORM: RouteForm = {
  'dst-address': '',
  gateway: '',
  distance: '1',
  'routing-mark': '',
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

function validateRouteForm(form: RouteForm): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form['dst-address']) {
    errors['dst-address'] = 'Destination address is required'
  } else if (!CIDR_REGEX.test(form['dst-address'])) {
    errors['dst-address'] = 'Must be valid CIDR (e.g. 10.0.0.0/24)'
  }
  if (!form.gateway) {
    errors.gateway = 'Gateway is required'
  }
  return errors
}

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// RoutesPanel
// ---------------------------------------------------------------------------

export function RoutesPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/route',
    { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'routes')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')

  const typedEntries = entries as RouteEntry[]

  const filteredEntries = useMemo(() => {
    switch (filterTab) {
      case 'static':
        return typedEntries.filter(
          (e) => e.static === 'true' && e.dynamic !== 'true',
        )
      case 'connected':
        return typedEntries.filter((e) => e.connect === 'true')
      case 'dynamic':
        return typedEntries.filter((e) => e.dynamic === 'true')
      default:
        return typedEntries
    }
  }, [typedEntries, filterTab])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading IP routes...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load IP routes.{' '}
        <button className="underline ml-1" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with SafetyToggle and Apply button */}
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button
          size="sm"
          disabled={panel.pendingChanges.length === 0 || panel.isApplying}
          onClick={() => setPreviewOpen(true)}
        >
          Review & Apply ({panel.pendingChanges.length})
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-elevated">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filterTab === tab.key
                ? 'bg-panel text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-panel/50',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Routes table */}
      <RoutesTable entries={filteredEntries} panel={panel} />

      {/* Change Preview Modal */}
      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={() => {
          panel.applyChanges()
          setPreviewOpen(false)
        }}
        isApplying={panel.isApplying}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function RouteStatusBadge({ entry }: { entry: RouteEntry }) {
  if (entry.disabled === 'true') {
    return (
      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">
        disabled
      </span>
    )
  }
  if (entry.active === 'true') {
    return (
      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">
        active
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-elevated text-text-muted border-border">
      inactive
    </span>
  )
}

// ---------------------------------------------------------------------------
// Routes Table
// ---------------------------------------------------------------------------

function RoutesTable({
  entries,
  panel,
}: {
  entries: RouteEntry[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RouteEntry | null>(null)
  const [form, setForm] = useState<RouteForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: RouteEntry) => {
    setEditing(entry)
    setForm({
      'dst-address': entry['dst-address'] || '',
      gateway: entry.gateway || '',
      distance: entry.distance || '1',
      'routing-mark': entry['routing-mark'] || '',
    })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: RouteEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/route',
        entryId: entry['.id'],
        properties: {},
        description: `Remove route ${entry['dst-address']} via ${entry.gateway || 'connected'}`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const validationErrors = validateRouteForm(form)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const props: Record<string, string> = {
      'dst-address': form['dst-address'],
      gateway: form.gateway,
    }
    if (form.distance && form.distance !== '1') {
      props.distance = form.distance
    }
    if (form['routing-mark']) {
      props['routing-mark'] = form['routing-mark']
    }

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/ip/route',
        entryId: editing['.id'],
        properties: props,
        description: `Edit route ${form['dst-address']} via ${form.gateway}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/route',
        properties: props,
        description: `Add route ${form['dst-address']} via ${form.gateway}`,
      })
    }

    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      {/* Table */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Route className="h-4 w-4" />
            IP Routes ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Route
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No routes found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Dst. Address</th>
                  <th className="text-left px-4 py-2 font-medium">Gateway</th>
                  <th className="text-left px-4 py-2 font-medium">Distance</th>
                  <th className="text-left px-4 py-2 font-medium">Routing Mark</th>
                  <th className="text-left px-4 py-2 font-medium">Interface</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry['.id']}
                    className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-text-primary">
                      {entry['dst-address'] || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {entry.gateway || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {entry.distance || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {entry['routing-mark'] || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {entry.interface || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <RouteStatusBadge entry={entry} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {entry.dynamic !== 'true' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleEdit(entry)}
                              title="Edit route"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-error hover:text-error"
                              onClick={() => handleDelete(entry)}
                              title="Delete route"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Route' : 'Add Route'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Modify the route properties below.'
                : 'Enter the route details. Changes are staged until you apply them.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label htmlFor="dst-address" className="text-xs text-text-secondary">
                Destination Address (CIDR)
              </Label>
              <Input
                id="dst-address"
                value={form['dst-address']}
                onChange={(e) =>
                  setForm((f) => ({ ...f, 'dst-address': e.target.value }))
                }
                placeholder="10.0.0.0/24"
                className={cn('h-8 text-sm font-mono', errors['dst-address'] && 'border-error')}
              />
              {errors['dst-address'] && (
                <p className="text-xs text-error">{errors['dst-address']}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="gateway" className="text-xs text-text-secondary">
                Gateway
              </Label>
              <Input
                id="gateway"
                value={form.gateway}
                onChange={(e) =>
                  setForm((f) => ({ ...f, gateway: e.target.value }))
                }
                placeholder="192.168.1.1 or ether1"
                className={cn('h-8 text-sm font-mono', errors.gateway && 'border-error')}
              />
              {errors.gateway && (
                <p className="text-xs text-error">{errors.gateway}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="distance" className="text-xs text-text-secondary">
                  Distance
                </Label>
                <Input
                  id="distance"
                  type="number"
                  value={form.distance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, distance: e.target.value }))
                  }
                  placeholder="1"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="routing-mark" className="text-xs text-text-secondary">
                  Routing Mark
                </Label>
                <Input
                  id="routing-mark"
                  value={form['routing-mark']}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, 'routing-mark': e.target.value }))
                  }
                  placeholder="optional"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? 'Stage Edit' : 'Stage Route'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
