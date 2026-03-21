/**
 * ArpPanel -- ARP table management panel for device configuration.
 *
 * Displays ARP entries from /ip/arp with filter tabs (All/Dynamic/Static),
 * add static ARP, delete entries, flush dynamic ARP cache action,
 * and standard apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Trash2, RefreshCw, Network } from 'lucide-react'
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
import { configEditorApi } from '@/lib/configEditorApi'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'dynamic' | 'static'

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'dynamic', label: 'Dynamic' },
  { key: 'static', label: 'Static' },
]

// ---------------------------------------------------------------------------
// Entry & form types
// ---------------------------------------------------------------------------

interface ArpEntry {
  '.id': string
  address: string
  'mac-address': string
  interface: string
  dynamic: string
  complete: string
  disabled: string
  [key: string]: string
}

interface ArpForm {
  address: string
  'mac-address': string
  interface: string
}

const EMPTY_FORM: ArpForm = {
  address: '',
  'mac-address': '',
  interface: '',
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/
const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/

function validateArpForm(form: ArpForm): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.address) {
    errors.address = 'IP address is required'
  } else if (!IP_REGEX.test(form.address)) {
    errors.address = 'Must be valid IP (e.g. 192.168.1.1)'
  }
  if (!form['mac-address']) {
    errors['mac-address'] = 'MAC address is required'
  } else if (!MAC_REGEX.test(form['mac-address'])) {
    errors['mac-address'] = 'Must be valid MAC (e.g. AA:BB:CC:DD:EE:FF)'
  }
  if (!form.interface) {
    errors.interface = 'Interface is required'
  }
  return errors
}

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// ArpPanel
// ---------------------------------------------------------------------------

export function ArpPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/arp',
    { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'arp')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')

  const typedEntries = entries as ArpEntry[]

  const filteredEntries = useMemo(() => {
    switch (filterTab) {
      case 'dynamic':
        return typedEntries.filter((e) => e.dynamic === 'true')
      case 'static':
        return typedEntries.filter((e) => e.dynamic !== 'true')
      default:
        return typedEntries
    }
  }, [typedEntries, filterTab])

  // Flush dynamic ARP cache
  const flushMutation = useMutation({
    mutationFn: () =>
      configEditorApi.execute(
        tenantId,
        deviceId,
        '/ip arp remove [find dynamic=yes]',
      ),
    onSuccess: () => {
      toast.success('ARP cache flushed')
      refetch()
    },
    onError: (err: Error) => {
      toast.error('Failed to flush ARP cache', { description: err.message })
    },
  })

  const handleFlush = useCallback(() => {
    if (confirm('Flush all dynamic ARP entries? This will clear the ARP cache.')) {
      flushMutation.mutate()
    }
  }, [flushMutation])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading ARP table...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load ARP table.{' '}
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

      {/* Filter tabs + Flush button */}
      <div className="flex items-center justify-between">
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={handleFlush}
          disabled={flushMutation.isPending}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', flushMutation.isPending && 'animate-spin')} />
          Flush ARP
        </Button>
      </div>

      {/* ARP table */}
      <ArpTable entries={filteredEntries} panel={panel} />

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
// ARP Table
// ---------------------------------------------------------------------------

function ArpTable({
  entries,
  panel,
}: {
  entries: ArpEntry[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<ArpForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setForm(EMPTY_FORM)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: ArpEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/arp',
        entryId: entry['.id'],
        properties: {},
        description: `Remove ARP entry ${entry.address} (${entry['mac-address']})`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const validationErrors = validateArpForm(form)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    panel.addChange({
      operation: 'add',
      path: '/ip/arp',
      properties: {
        address: form.address,
        'mac-address': form['mac-address'],
        interface: form.interface,
      },
      description: `Add static ARP ${form.address} → ${form['mac-address']} on ${form.interface}`,
    })

    setDialogOpen(false)
  }, [form, panel])

  return (
    <>
      {/* Table */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Network className="h-4 w-4" />
            ARP Table ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Static ARP
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No ARP entries found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">IP Address</th>
                  <th className="text-left px-4 py-2 font-medium">MAC Address</th>
                  <th className="text-left px-4 py-2 font-medium">Interface</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">Complete</th>
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
                      {entry.address || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {entry['mac-address'] || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {entry.interface || '—'}
                    </td>
                    <td className="px-4 py-2">
                      {entry.dynamic === 'true' ? (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-elevated text-text-muted border-border">
                          dynamic
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">
                          static
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {entry.complete === 'true' ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-success" title="Complete" />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-warning" title="Incomplete" />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {entry.dynamic !== 'true' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-error hover:text-error"
                            onClick={() => handleDelete(entry)}
                            title="Delete ARP entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Add Static ARP Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Static ARP Entry</DialogTitle>
            <DialogDescription>
              Create a static ARP mapping. Changes are staged until you apply them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label htmlFor="arp-address" className="text-xs text-text-secondary">
                IP Address
              </Label>
              <Input
                id="arp-address"
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
                placeholder="192.168.1.100"
                className={cn('h-8 text-sm font-mono', errors.address && 'border-error')}
              />
              {errors.address && (
                <p className="text-xs text-error">{errors.address}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="arp-mac" className="text-xs text-text-secondary">
                MAC Address
              </Label>
              <Input
                id="arp-mac"
                value={form['mac-address']}
                onChange={(e) =>
                  setForm((f) => ({ ...f, 'mac-address': e.target.value }))
                }
                placeholder="AA:BB:CC:DD:EE:FF"
                className={cn('h-8 text-sm font-mono', errors['mac-address'] && 'border-error')}
              />
              {errors['mac-address'] && (
                <p className="text-xs text-error">{errors['mac-address']}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="arp-interface" className="text-xs text-text-secondary">
                Interface
              </Label>
              <Input
                id="arp-interface"
                value={form.interface}
                onChange={(e) =>
                  setForm((f) => ({ ...f, interface: e.target.value }))
                }
                placeholder="ether1"
                className={cn('h-8 text-sm', errors.interface && 'border-error')}
              />
              {errors.interface && (
                <p className="text-xs text-error">{errors.interface}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Stage ARP Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
