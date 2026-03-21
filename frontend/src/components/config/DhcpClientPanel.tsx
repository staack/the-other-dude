/**
 * DhcpClientPanel -- DHCP Client management panel for device configuration.
 *
 * Displays /ip/dhcp-client entries with interface, status, obtained address,
 * gateway, DNS, and options (use-peer-dns, use-peer-ntp, add-default-route).
 * Supports add, edit, delete, enable/disable via the standard config panel workflow.
 */

import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Globe, Power, PowerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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

interface DhcpClientEntry {
  '.id': string
  interface: string
  status: string
  address: string
  gateway: string
  'primary-dns': string
  'secondary-dns': string
  'use-peer-dns': string
  'use-peer-ntp': string
  'add-default-route': string
  disabled: string
  dynamic: string
  comment: string
  [key: string]: string
}

interface DhcpClientForm {
  interface: string
  'use-peer-dns': boolean
  'use-peer-ntp': boolean
  'add-default-route': boolean
  comment: string
}

const EMPTY_FORM: DhcpClientForm = {
  interface: '',
  'use-peer-dns': true,
  'use-peer-ntp': true,
  'add-default-route': true,
  comment: '',
}

// ---------------------------------------------------------------------------
// DhcpClientPanel
// ---------------------------------------------------------------------------

export function DhcpClientPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/dhcp-client',
    { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'dhcp-client')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<DhcpClientForm>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const typedEntries = entries as DhcpClientEntry[]

  const handleAdd = useCallback(() => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: DhcpClientEntry) => {
    setEditingId(entry['.id'])
    setForm({
      interface: entry.interface || '',
      'use-peer-dns': entry['use-peer-dns'] !== 'false',
      'use-peer-ntp': entry['use-peer-ntp'] !== 'false',
      'add-default-route': entry['add-default-route'] !== 'no',
      comment: entry.comment || '',
    })
    setFormErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: DhcpClientEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/dhcp-client',
        entryId: entry['.id'],
        properties: {},
        description: `Remove DHCP client on ${entry.interface}`,
      })
    },
    [panel],
  )

  const handleToggle = useCallback(
    (entry: DhcpClientEntry) => {
      const newDisabled = entry.disabled === 'true' ? 'false' : 'true'
      panel.addChange({
        operation: 'set',
        path: '/ip/dhcp-client',
        entryId: entry['.id'],
        properties: { disabled: newDisabled },
        description: `${newDisabled === 'true' ? 'Disable' : 'Enable'} DHCP client on ${entry.interface}`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const errors: Record<string, string> = {}
    if (!form.interface.trim()) {
      errors.interface = 'Interface is required'
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    const properties: Record<string, string> = {
      interface: form.interface.trim(),
      'use-peer-dns': form['use-peer-dns'] ? 'yes' : 'no',
      'use-peer-ntp': form['use-peer-ntp'] ? 'yes' : 'no',
      'add-default-route': form['add-default-route'] ? 'yes' : 'no',
    }
    if (form.comment.trim()) {
      properties.comment = form.comment.trim()
    }

    if (editingId) {
      panel.addChange({
        operation: 'set',
        path: '/ip/dhcp-client',
        entryId: editingId,
        properties,
        description: `Update DHCP client on ${form.interface}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/dhcp-client',
        properties,
        description: `Add DHCP client on ${form.interface}`,
      })
    }

    setDialogOpen(false)
  }, [form, editingId, panel])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading DHCP clients...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load DHCP clients.{' '}
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

      {/* DHCP Client table */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Globe className="h-4 w-4" />
            DHCP Clients ({typedEntries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add DHCP Client
          </Button>
        </div>

        {typedEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No DHCP clients configured.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Interface</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Address</th>
                  <th className="text-left px-4 py-2 font-medium">Gateway</th>
                  <th className="text-left px-4 py-2 font-medium">DNS</th>
                  <th className="text-left px-4 py-2 font-medium">Options</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {typedEntries.map((entry) => (
                  <tr
                    key={entry['.id']}
                    className={cn(
                      'border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors',
                      entry.disabled === 'true' && 'opacity-50',
                    )}
                  >
                    <td className="px-4 py-2 font-mono text-text-primary">
                      {entry.interface || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={entry.status} disabled={entry.disabled === 'true'} />
                    </td>
                    <td className="px-4 py-2 font-mono text-text-primary">
                      {entry.address || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {entry.gateway || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary text-xs">
                      {entry['primary-dns'] || '—'}
                      {entry['secondary-dns'] && `, ${entry['secondary-dns']}`}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {entry['use-peer-dns'] !== 'false' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">DNS</span>
                        )}
                        {entry['use-peer-ntp'] !== 'false' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">NTP</span>
                        )}
                        {entry['add-default-route'] !== 'no' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">Route</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleToggle(entry)}
                          title={entry.disabled === 'true' ? 'Enable' : 'Disable'}
                        >
                          {entry.disabled === 'true' ? (
                            <PowerOff className="h-3.5 w-3.5 text-text-muted" />
                          ) : (
                            <Power className="h-3.5 w-3.5 text-success" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleEdit(entry)}
                          title="Edit DHCP client"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-error hover:text-error"
                          onClick={() => handleDelete(entry)}
                          title="Delete DHCP client"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
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
            <DialogTitle>{editingId ? 'Edit' : 'Add'} DHCP Client</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Update DHCP client settings. Changes are staged until you apply them.'
                : 'Add a DHCP client on an interface to obtain an IP address automatically.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label htmlFor="dhcpc-interface" className="text-xs text-text-secondary">
                Interface
              </Label>
              <Input
                id="dhcpc-interface"
                value={form.interface}
                onChange={(e) => setForm((f) => ({ ...f, interface: e.target.value }))}
                placeholder="ether1"
                disabled={!!editingId}
                className={cn('h-8 text-sm', formErrors.interface && 'border-error')}
              />
              {formErrors.interface && (
                <p className="text-xs text-error">{formErrors.interface}</p>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dhcpc-peer-dns"
                  checked={form['use-peer-dns']}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, 'use-peer-dns': !!checked }))
                  }
                />
                <Label htmlFor="dhcpc-peer-dns" className="text-sm">
                  Use peer DNS
                </Label>
                <span className="text-xs text-text-muted">Accept DNS servers from DHCP server</span>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="dhcpc-peer-ntp"
                  checked={form['use-peer-ntp']}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, 'use-peer-ntp': !!checked }))
                  }
                />
                <Label htmlFor="dhcpc-peer-ntp" className="text-sm">
                  Use peer NTP
                </Label>
                <span className="text-xs text-text-muted">Accept time servers from DHCP server</span>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="dhcpc-default-route"
                  checked={form['add-default-route']}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, 'add-default-route': !!checked }))
                  }
                />
                <Label htmlFor="dhcpc-default-route" className="text-sm">
                  Add default route
                </Label>
                <span className="text-xs text-text-muted">Create default gateway via this connection</span>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dhcpc-comment" className="text-xs text-text-secondary">
                Comment
              </Label>
              <Input
                id="dhcpc-comment"
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="WAN connection"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingId ? 'Stage Changes' : 'Stage DHCP Client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function StatusBadge({ status, disabled }: { status: string; disabled: boolean }) {
  if (disabled) {
    return (
      <Badge variant="outline" className="text-[10px] text-text-muted border-border">
        disabled
      </Badge>
    )
  }

  switch (status) {
    case 'bound':
      return (
        <Badge variant="outline" className="text-[10px] text-success border-success/40 bg-success/10">
          bound
        </Badge>
      )
    case 'searching':
      return (
        <Badge variant="outline" className="text-[10px] text-warning border-warning/40 bg-warning/10">
          searching
        </Badge>
      )
    case 'requesting':
    case 'rebinding':
    case 'renewing':
      return (
        <Badge variant="outline" className="text-[10px] text-accent border-accent/40 bg-accent/10">
          {status}
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-[10px] text-text-muted border-border">
          {status || '—'}
        </Badge>
      )
  }
}
