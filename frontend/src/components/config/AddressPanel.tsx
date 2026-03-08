/**
 * AddressPanel -- IP address management panel for device configuration.
 *
 * Displays addresses from /ip/address with interface selector dropdown,
 * CIDR validation with network auto-calculation, add/edit/delete dialogs,
 * and safe apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Network } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SafetyToggle } from './SafetyToggle'
import { ChangePreviewModal } from './ChangePreviewModal'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Entry & form types
// ---------------------------------------------------------------------------

interface AddressEntry {
  '.id': string
  address: string
  network: string
  broadcast: string
  interface: string
  'actual-interface': string
  disabled: string
  dynamic: string
  [key: string]: string
}

interface AddressForm {
  address: string
  interface: string
}

const EMPTY_FORM: AddressForm = {
  address: '',
  interface: '',
}

// ---------------------------------------------------------------------------
// Validation & helpers
// ---------------------------------------------------------------------------

const CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

function validateAddressForm(form: AddressForm): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.address) {
    errors.address = 'Address is required'
  } else if (!CIDR_REGEX.test(form.address)) {
    errors.address = 'Must be valid CIDR (e.g. 192.168.1.1/24)'
  }
  if (!form.interface) {
    errors.interface = 'Interface is required'
  }
  return errors
}

/**
 * Calculate network address from CIDR notation.
 * e.g. "192.168.1.100/24" → "192.168.1.0/24"
 */
function calculateNetwork(cidr: string): string | null {
  if (!CIDR_REGEX.test(cidr)) return null
  const [ipStr, maskStr] = cidr.split('/')
  const mask = parseInt(maskStr, 10)
  if (mask < 0 || mask > 32) return null

  const octets = ipStr.split('.').map(Number)
  if (octets.some((o) => o < 0 || o > 255)) return null

  const ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0
  const network = (ip & maskBits) >>> 0

  return [
    (network >>> 24) & 0xff,
    (network >>> 16) & 0xff,
    (network >>> 8) & 0xff,
    network & 0xff,
  ].join('.') + '/' + mask
}

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// AddressPanel
// ---------------------------------------------------------------------------

export function AddressPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/address',
    { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'addresses')

  const [previewOpen, setPreviewOpen] = useState(false)

  const typedEntries = entries as AddressEntry[]

  // Collect unique interface names for the selector dropdown
  const interfaceNames = useMemo(() => {
    const names = new Set<string>()
    typedEntries.forEach((e) => {
      if (e.interface) names.add(e.interface)
      if (e['actual-interface']) names.add(e['actual-interface'])
    })
    return Array.from(names).sort()
  }, [typedEntries])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading IP addresses...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load IP addresses.{' '}
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

      {/* Address table */}
      <AddressTable
        entries={typedEntries}
        panel={panel}
        interfaceNames={interfaceNames}
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
// Address Table
// ---------------------------------------------------------------------------

function AddressTable({
  entries,
  panel,
  interfaceNames,
}: {
  entries: AddressEntry[]
  panel: PanelHook
  interfaceNames: string[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AddressEntry | null>(null)
  const [form, setForm] = useState<AddressForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [customInterface, setCustomInterface] = useState(false)

  const calculatedNetwork = useMemo(
    () => calculateNetwork(form.address),
    [form.address],
  )

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setCustomInterface(false)
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: AddressEntry) => {
    setEditing(entry)
    setForm({
      address: entry.address || '',
      interface: entry.interface || '',
    })
    setErrors({})
    setCustomInterface(false)
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: AddressEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/address',
        entryId: entry['.id'],
        properties: {},
        description: `Remove address ${entry.address} from ${entry.interface || 'unknown'}`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const validationErrors = validateAddressForm(form)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const props: Record<string, string> = {
      address: form.address,
      interface: form.interface,
    }

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/ip/address',
        entryId: editing['.id'],
        properties: props,
        description: `Edit address ${form.address} on ${form.interface}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/address',
        properties: props,
        description: `Add address ${form.address} to ${form.interface}`,
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
            <Network className="h-4 w-4" />
            IP Addresses ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Address
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No IP addresses found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Address</th>
                  <th className="text-left px-4 py-2 font-medium">Network</th>
                  <th className="text-left px-4 py-2 font-medium">Broadcast</th>
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
                      {entry.address || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {entry.network || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {entry.broadcast || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {entry['actual-interface'] || entry.interface || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <AddressStatusBadge entry={entry} />
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
                              title="Edit address"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-error hover:text-error"
                              onClick={() => handleDelete(entry)}
                              title="Delete address"
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
            <DialogTitle>{editing ? 'Edit Address' : 'Add Address'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Modify the address properties below.'
                : 'Enter the address details. Changes are staged until you apply them.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label htmlFor="address" className="text-xs text-text-secondary">
                IP Address (CIDR)
              </Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
                placeholder="192.168.1.1/24"
                className={cn('h-8 text-sm font-mono', errors.address && 'border-error')}
              />
              {errors.address && (
                <p className="text-xs text-error">{errors.address}</p>
              )}
              {calculatedNetwork && (
                <p className="text-xs text-text-muted">
                  Network: <span className="font-mono">{calculatedNetwork}</span>
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="interface-select" className="text-xs text-text-secondary">
                Interface
              </Label>
              {!customInterface && interfaceNames.length > 0 ? (
                <div className="flex gap-2">
                  <Select
                    value={form.interface}
                    onValueChange={(v) => setForm((f) => ({ ...f, interface: v }))}
                  >
                    <SelectTrigger
                      id="interface-select"
                      className={cn('h-8 text-sm flex-1', errors.interface && 'border-error')}
                    >
                      <SelectValue placeholder="Select interface..." />
                    </SelectTrigger>
                    <SelectContent>
                      {interfaceNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setCustomInterface(true)}
                  >
                    Custom
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="interface-custom"
                    value={form.interface}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, interface: e.target.value }))
                    }
                    placeholder="ether1"
                    className={cn('h-8 text-sm flex-1', errors.interface && 'border-error')}
                  />
                  {interfaceNames.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setCustomInterface(false)}
                    >
                      List
                    </Button>
                  )}
                </div>
              )}
              {errors.interface && (
                <p className="text-xs text-error">{errors.interface}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? 'Stage Edit' : 'Stage Address'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function AddressStatusBadge({ entry }: { entry: AddressEntry }) {
  if (entry.disabled === 'true') {
    return (
      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">
        disabled
      </span>
    )
  }
  if (entry.dynamic === 'true') {
    return (
      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-info/10 text-info border-info/40">
        dynamic
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">
      active
    </span>
  )
}
