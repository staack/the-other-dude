/**
 * PoolPanel -- IP pool management panel for device configuration.
 *
 * Displays IP pools from /ip/pool with range editor, next-pool chaining,
 * used-by DHCP indicator, add/edit/delete dialogs,
 * and standard apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Layers } from 'lucide-react'
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
// Entry & form types
// ---------------------------------------------------------------------------

interface PoolEntry {
  '.id': string
  name: string
  ranges: string
  'next-pool': string
  [key: string]: string
}

interface DhcpServerEntry {
  '.id': string
  name: string
  'address-pool': string
  [key: string]: string
}

interface PoolForm {
  name: string
  ranges: string
  'next-pool': string
}

const EMPTY_FORM: PoolForm = {
  name: '',
  ranges: '',
  'next-pool': '',
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/

function validateRange(range: string): boolean {
  const trimmed = range.trim()
  if (!trimmed) return false
  const parts = trimmed.split('-')
  if (parts.length !== 2) return false
  return IP_REGEX.test(parts[0].trim()) && IP_REGEX.test(parts[1].trim())
}

function validatePoolForm(form: PoolForm): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.name) {
    errors.name = 'Pool name is required'
  }
  if (!form.ranges) {
    errors.ranges = 'At least one range is required'
  } else {
    const ranges = form.ranges.split(',')
    const invalid = ranges.filter((r) => !validateRange(r))
    if (invalid.length > 0) {
      errors.ranges = 'Each range must be in format x.x.x.x-x.x.x.x'
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// PoolPanel
// ---------------------------------------------------------------------------

export function PoolPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/pool',
    { enabled: active },
  )

  // Fetch DHCP servers to show used-by indicator
  const { entries: dhcpEntries } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/dhcp-server',
    { enabled: active },
  )

  const panel = useConfigPanel(tenantId, deviceId, 'pools')
  const [previewOpen, setPreviewOpen] = useState(false)

  const typedEntries = entries as PoolEntry[]
  const dhcpServers = dhcpEntries as DhcpServerEntry[]

  // Build a map of pool name → DHCP server names that use it
  const poolUsedBy = useMemo(() => {
    const map: Record<string, string[]> = {}
    dhcpServers.forEach((server) => {
      const pool = server['address-pool']
      if (pool) {
        if (!map[pool]) map[pool] = []
        map[pool].push(server.name || server['.id'])
      }
    })
    return map
  }, [dhcpServers])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading IP pools...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load IP pools.{' '}
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

      {/* Pool table */}
      <PoolTable
        entries={typedEntries}
        panel={panel}
        poolUsedBy={poolUsedBy}
        existingPools={typedEntries.map((e) => e.name).filter(Boolean)}
      />

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
// Pool Table
// ---------------------------------------------------------------------------

function PoolTable({
  entries,
  panel,
  poolUsedBy,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  existingPools: _existingPools,
}: {
  entries: PoolEntry[]
  panel: PanelHook
  poolUsedBy: Record<string, string[]>
  existingPools: string[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PoolEntry | null>(null)
  const [form, setForm] = useState<PoolForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: PoolEntry) => {
    setEditing(entry)
    setForm({
      name: entry.name || '',
      ranges: entry.ranges || '',
      'next-pool': entry['next-pool'] || '',
    })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: PoolEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/pool',
        entryId: entry['.id'],
        properties: {},
        description: `Remove pool "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const validationErrors = validatePoolForm(form)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const props: Record<string, string> = {
      name: form.name,
      ranges: form.ranges,
    }
    if (form['next-pool']) {
      props['next-pool'] = form['next-pool']
    }

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/ip/pool',
        entryId: editing['.id'],
        properties: props,
        description: `Edit pool "${form.name}" ranges ${form.ranges}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/pool',
        properties: props,
        description: `Add pool "${form.name}" with ranges ${form.ranges}`,
      })
    }

    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      {/* Table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Layers className="h-4 w-4" />
            IP Pools ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Pool
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No IP pools configured.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Ranges</th>
                  <th className="text-left px-4 py-2 font-medium">Next Pool</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const usedBy = poolUsedBy[entry.name]
                  return (
                    <tr
                      key={entry['.id']}
                      className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors"
                    >
                      <td className="px-4 py-2">
                        <div>
                          <span className="text-text-primary font-medium">
                            {entry.name || '—'}
                          </span>
                          {usedBy && usedBy.length > 0 && (
                            <div className="text-xs text-text-muted mt-0.5">
                              Used by: {usedBy.join(', ')}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-text-secondary">
                        {entry.ranges || '—'}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {entry['next-pool'] || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEdit(entry)}
                            title="Edit pool"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-error hover:text-error"
                            onClick={() => handleDelete(entry)}
                            title="Delete pool"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Pool' : 'Add Pool'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Modify the pool properties below.'
                : 'Enter the pool details. Changes are staged until you apply them.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label htmlFor="pool-name" className="text-xs text-text-secondary">
                Pool Name
              </Label>
              <Input
                id="pool-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="dhcp-pool1"
                className={cn('h-8 text-sm', errors.name && 'border-error')}
              />
              {errors.name && (
                <p className="text-xs text-error">{errors.name}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="pool-ranges" className="text-xs text-text-secondary">
                Ranges
              </Label>
              <Input
                id="pool-ranges"
                value={form.ranges}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ranges: e.target.value }))
                }
                placeholder="192.168.1.100-192.168.1.200"
                className={cn('h-8 text-sm font-mono', errors.ranges && 'border-error')}
              />
              {errors.ranges && (
                <p className="text-xs text-error">{errors.ranges}</p>
              )}
              <p className="text-xs text-text-muted">
                Use start-end notation. Comma-separate multiple ranges.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pool-next" className="text-xs text-text-secondary">
                Next Pool
              </Label>
              <Input
                id="pool-next"
                value={form['next-pool']}
                onChange={(e) =>
                  setForm((f) => ({ ...f, 'next-pool': e.target.value }))
                }
                placeholder="none"
                className="h-8 text-sm"
              />
              <p className="text-xs text-text-muted">
                Leave empty if no chaining needed.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? 'Stage Edit' : 'Stage Pool'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
