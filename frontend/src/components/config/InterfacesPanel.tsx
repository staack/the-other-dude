/**
 * InterfacesPanel -- Guided interface configuration for RouterOS devices.
 *
 * Sub-tabs: Interfaces, IP Addresses, VLANs, Bridges
 * Each tab provides browse data + add/edit/remove forms.
 * All changes flow through useConfigPanel -> ChangePreviewModal.
 */

import { useState, useMemo, useCallback } from 'react'
import {
  Network,
  Globe,
  Layers,
  GitBranch,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingText } from '@/components/ui/skeleton'
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
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SafetyToggle } from '@/components/config/SafetyToggle'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import type { ConfigPanelProps, ConfigChange } from '@/lib/configPanelTypes'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Sub-tab definitions
// ---------------------------------------------------------------------------

type SubTab = 'interfaces' | 'ip-addresses' | 'vlans' | 'bridges'

const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
  { key: 'interfaces', label: 'Interfaces', icon: Network },
  { key: 'ip-addresses', label: 'IP Addresses', icon: Globe },
  { key: 'vlans', label: 'VLANs', icon: Layers },
  { key: 'bridges', label: 'Bridges', icon: GitBranch },
]

// ---------------------------------------------------------------------------
// Type badge color map
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  ether: '#3B82F6',
  bridge: '#8B5CF6',
  vlan: '#F59E0B',
  bonding: '#10B981',
  pppoe: '#EF4444',
  l2tp: '#EC4899',
  ovpn: '#06B6D4',
  wlan: '#84CC16',
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

function isValidCidr(value: string): boolean {
  if (!CIDR_REGEX.test(value)) return false
  const [ip, mask] = value.split('/')
  const parts = ip.split('.').map(Number)
  if (parts.some((p) => p < 0 || p > 255)) return false
  const maskNum = Number(mask)
  return maskNum >= 0 && maskNum <= 32
}

function isValidVlanId(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 4094
}

// ---------------------------------------------------------------------------
// InterfacesPanel
// ---------------------------------------------------------------------------

export function InterfacesPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>('interfaces')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Shared config panel hook
  const panel = useConfigPanel(tenantId, deviceId, 'interfaces')

  // Browse data
  const interfaces = useConfigBrowse(tenantId, deviceId, '/interface', { enabled: active })
  const ipAddresses = useConfigBrowse(tenantId, deviceId, '/ip/address', { enabled: active })
  const vlans = useConfigBrowse(tenantId, deviceId, '/interface/vlan', { enabled: active })
  const bridges = useConfigBrowse(tenantId, deviceId, '/interface/bridge', { enabled: active })
  const bridgePorts = useConfigBrowse(tenantId, deviceId, '/interface/bridge/port', {
    enabled: active,
  })

  // Interface name list for select fields
  const interfaceNames = useMemo(
    () => interfaces.entries.map((e) => e.name).filter(Boolean),
    [interfaces.entries],
  )
  const bridgeNames = useMemo(
    () => bridges.entries.map((e) => e.name).filter(Boolean),
    [bridges.entries],
  )

  const refetchAll = useCallback(() => {
    interfaces.refetch()
    ipAddresses.refetch()
    vlans.refetch()
    bridges.refetch()
    bridgePorts.refetch()
  }, [interfaces, ipAddresses, vlans, bridges, bridgePorts])

  const handleApplyConfirm = useCallback(() => {
    panel.applyChanges()
    setPreviewOpen(false)
    // Refetch after a short delay to allow the device to process
    setTimeout(refetchAll, 1500)
  }, [panel, refetchAll])

  return (
    <div className="space-y-4">
      {/* Header: safety toggle + apply button */}
      <div className="flex items-start justify-between gap-4">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button
          onClick={() => setPreviewOpen(true)}
          disabled={panel.pendingChanges.length === 0}
          className="gap-1.5 shrink-0"
        >
          Review & Apply
          {panel.pendingChanges.length > 0 && (
            <Badge className="ml-1 bg-accent/20 text-accent border-accent/40 text-xs">
              {panel.pendingChanges.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Sub-tab buttons */}
      <div className="flex items-center gap-1">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            onClick={() => setSubTab(key)}
            className={cn(
              'gap-1.5',
              subTab === key ? 'bg-elevated text-text-primary' : 'text-text-secondary',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* Sub-tab content */}
      {subTab === 'interfaces' && (
        <InterfacesTable entries={interfaces.entries} isLoading={interfaces.isLoading} />
      )}
      {subTab === 'ip-addresses' && (
        <IpAddressesTab
          entries={ipAddresses.entries}
          isLoading={ipAddresses.isLoading}
          interfaceNames={interfaceNames}
          addChange={panel.addChange}
        />
      )}
      {subTab === 'vlans' && (
        <VlansTab
          entries={vlans.entries}
          isLoading={vlans.isLoading}
          interfaceNames={interfaceNames}
          addChange={panel.addChange}
        />
      )}
      {subTab === 'bridges' && (
        <BridgesTab
          bridges={bridges.entries}
          bridgePorts={bridgePorts.entries}
          isLoading={bridges.isLoading || bridgePorts.isLoading}
          interfaceNames={interfaceNames}
          bridgeNames={bridgeNames}
          addChange={panel.addChange}
        />
      )}

      {/* Change preview modal */}
      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={handleApplyConfirm}
        isApplying={panel.isApplying}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

function TableLoading() {
  return (
    <div className="py-8 text-center">
      <LoadingText />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Interfaces Tab (read-only list)
// ---------------------------------------------------------------------------

function InterfacesTable({
  entries,
  isLoading,
}: {
  entries: Record<string, string>[]
  isLoading: boolean
}) {
  if (isLoading) return <TableLoading />

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-8 text-center text-text-secondary text-sm">
        No interfaces found on this device.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-panel overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-elevated/30">
            <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">Name</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">Type</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">Status</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">MAC</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">MTU</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const isRunning = entry.running === 'true'
            const isDisabled = entry.disabled === 'true'
            const ifType = entry.type || 'unknown'
            return (
              <tr key={entry['.id'] || i} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium text-text-primary">{entry.name || '---'}</td>
                <td className="px-3 py-2">
                  <Badge color={TYPE_COLORS[ifType] || null}>{ifType}</Badge>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-block h-2 w-2 rounded-full',
                        isDisabled ? 'bg-text-muted' : isRunning ? 'bg-success' : 'bg-text-muted',
                      )}
                    />
                    <span className="text-text-secondary text-xs">
                      {isDisabled ? 'disabled' : isRunning ? 'running' : 'down'}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                  {entry['mac-address'] || '---'}
                </td>
                <td className="px-3 py-2 text-text-secondary">{entry.mtu || '---'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IP Addresses Tab
// ---------------------------------------------------------------------------

interface IpAddressesTabProps {
  entries: Record<string, string>[]
  isLoading: boolean
  interfaceNames: string[]
  addChange: (c: ConfigChange) => void
}

function IpAddressesTab({ entries, isLoading, interfaceNames, addChange }: IpAddressesTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<Record<string, string> | null>(null)

  const openAdd = () => {
    setEditEntry(null)
    setDialogOpen(true)
  }
  const openEdit = (entry: Record<string, string>) => {
    setEditEntry(entry)
    setDialogOpen(true)
  }
  const handleRemove = (entry: Record<string, string>) => {
    addChange({
      operation: 'remove',
      path: '/ip/address',
      entryId: entry['.id'],
      properties: {},
      description: `Remove IP ${entry.address} from ${entry.interface}`,
    })
  }
  const handleToggle = (entry: Record<string, string>) => {
    const newDisabled = entry.disabled === 'true' ? 'no' : 'yes'
    addChange({
      operation: 'set',
      path: '/ip/address',
      entryId: entry['.id'],
      properties: { disabled: newDisabled },
      description: `${newDisabled === 'yes' ? 'Disable' : 'Enable'} IP ${entry.address} on ${entry.interface}`,
    })
  }

  if (isLoading) return <TableLoading />

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={openAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add IP Address
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-center text-text-secondary text-sm">
          No IP addresses configured.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-elevated/30">
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Address
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Network
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Interface
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Status
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-text-secondary">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const isDisabled = entry.disabled === 'true'
                return (
                  <tr key={entry['.id'] || i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-text-primary">
                      {entry.address || '---'}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-secondary">
                      {entry.network || '---'}
                    </td>
                    <td className="px-3 py-2 text-text-primary">{entry.interface || '---'}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-block h-2 w-2 rounded-full',
                            isDisabled ? 'bg-text-muted' : 'bg-success',
                          )}
                        />
                        <span className="text-text-secondary text-xs">
                          {isDisabled ? 'disabled' : 'active'}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EntryActions
                        entry={entry}
                        onEdit={openEdit}
                        onRemove={handleRemove}
                        onToggle={handleToggle}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <IpAddressDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editEntry}
        interfaceNames={interfaceNames}
        addChange={addChange}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// IP Address Dialog
// ---------------------------------------------------------------------------

function IpAddressDialog({
  open,
  onOpenChange,
  entry,
  interfaceNames,
  addChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  interfaceNames: string[]
  addChange: (c: ConfigChange) => void
}) {
  const isEdit = !!entry
  const [address, setAddress] = useState('')
  const [iface, setIface] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState('')

  // Reset form when dialog opens
  const handleOpenChange = (val: boolean) => {
    if (val) {
      setAddress(entry?.address || '')
      setIface(entry?.interface || '')
      setDisabled(entry?.disabled === 'true')
      setError('')
    }
    onOpenChange(val)
  }

  const handleSubmit = () => {
    if (!isValidCidr(address)) {
      setError('Invalid CIDR format. Use format like 192.168.1.1/24')
      return
    }
    if (!iface) {
      setError('Please select an interface')
      return
    }
    setError('')

    const properties: Record<string, string> = {
      address,
      interface: iface,
      disabled: disabled ? 'yes' : 'no',
    }

    if (isEdit) {
      addChange({
        operation: 'set',
        path: '/ip/address',
        entryId: entry['.id'],
        properties,
        description: `Update IP ${address} on ${iface}`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/ip/address',
        properties,
        description: `Add IP ${address} to ${iface}`,
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit IP Address' : 'Add IP Address'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Modify the IP address configuration.'
              : 'Add a new IP address to an interface.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ip-address">Address (CIDR)</Label>
            <Input
              id="ip-address"
              placeholder="192.168.1.1/24"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ip-interface">Interface</Label>
            <Select value={iface} onValueChange={setIface}>
              <SelectTrigger>
                <SelectValue placeholder="Select interface" />
              </SelectTrigger>
              <SelectContent>
                {interfaceNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="ip-disabled"
              checked={disabled}
              onCheckedChange={(v) => setDisabled(v === true)}
            />
            <Label htmlFor="ip-disabled">Disabled</Label>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Add'} Change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// VLANs Tab
// ---------------------------------------------------------------------------

interface VlansTabProps {
  entries: Record<string, string>[]
  isLoading: boolean
  interfaceNames: string[]
  addChange: (c: ConfigChange) => void
}

function VlansTab({ entries, isLoading, interfaceNames, addChange }: VlansTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<Record<string, string> | null>(null)

  const openAdd = () => {
    setEditEntry(null)
    setDialogOpen(true)
  }
  const openEdit = (entry: Record<string, string>) => {
    setEditEntry(entry)
    setDialogOpen(true)
  }
  const handleRemove = (entry: Record<string, string>) => {
    addChange({
      operation: 'remove',
      path: '/interface/vlan',
      entryId: entry['.id'],
      properties: {},
      description: `Remove VLAN ${entry.name} (ID: ${entry['vlan-id']})`,
    })
  }
  const handleToggle = (entry: Record<string, string>) => {
    const newDisabled = entry.disabled === 'true' ? 'no' : 'yes'
    addChange({
      operation: 'set',
      path: '/interface/vlan',
      entryId: entry['.id'],
      properties: { disabled: newDisabled },
      description: `${newDisabled === 'yes' ? 'Disable' : 'Enable'} VLAN ${entry.name}`,
    })
  }

  if (isLoading) return <TableLoading />

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={openAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add VLAN
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-center text-text-secondary text-sm">
          No VLANs configured.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-elevated/30">
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Name
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  VLAN ID
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Interface
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                  Status
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-text-secondary">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const isDisabled = entry.disabled === 'true'
                return (
                  <tr key={entry['.id'] || i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-text-primary">
                      {entry.name || '---'}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-primary">
                      {entry['vlan-id'] || '---'}
                    </td>
                    <td className="px-3 py-2 text-text-primary">{entry.interface || '---'}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-block h-2 w-2 rounded-full',
                            isDisabled ? 'bg-text-muted' : 'bg-success',
                          )}
                        />
                        <span className="text-text-secondary text-xs">
                          {isDisabled ? 'disabled' : 'active'}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EntryActions
                        entry={entry}
                        onEdit={openEdit}
                        onRemove={handleRemove}
                        onToggle={handleToggle}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <VlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editEntry}
        interfaceNames={interfaceNames}
        addChange={addChange}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// VLAN Dialog
// ---------------------------------------------------------------------------

function VlanDialog({
  open,
  onOpenChange,
  entry,
  interfaceNames,
  addChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  interfaceNames: string[]
  addChange: (c: ConfigChange) => void
}) {
  const isEdit = !!entry
  const [name, setName] = useState('')
  const [vlanId, setVlanId] = useState('')
  const [iface, setIface] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState('')

  const handleOpenChange = (val: boolean) => {
    if (val) {
      setName(entry?.name || '')
      setVlanId(entry?.['vlan-id'] || '')
      setIface(entry?.interface || '')
      setDisabled(entry?.disabled === 'true')
      setError('')
    }
    onOpenChange(val)
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('VLAN name is required')
      return
    }
    const vid = Number(vlanId)
    if (!isValidVlanId(vid)) {
      setError('VLAN ID must be between 1 and 4094')
      return
    }
    if (!iface) {
      setError('Please select a parent interface')
      return
    }
    setError('')

    const properties: Record<string, string> = {
      name: name.trim(),
      'vlan-id': String(vid),
      interface: iface,
      disabled: disabled ? 'yes' : 'no',
    }

    if (isEdit) {
      addChange({
        operation: 'set',
        path: '/interface/vlan',
        entryId: entry['.id'],
        properties,
        description: `Update VLAN ${name} (ID: ${vid}) on ${iface}`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/interface/vlan',
        properties,
        description: `Add VLAN ${name} (ID: ${vid}) on ${iface}`,
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit VLAN' : 'Add VLAN'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Modify the VLAN configuration.' : 'Create a new VLAN interface.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vlan-name">Name</Label>
            <Input
              id="vlan-name"
              placeholder="vlan100-mgmt"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vlan-id">VLAN ID (1-4094)</Label>
            <Input
              id="vlan-id"
              type="number"
              min={1}
              max={4094}
              placeholder="100"
              value={vlanId}
              onChange={(e) => setVlanId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vlan-interface">Parent Interface</Label>
            <Select value={iface} onValueChange={setIface}>
              <SelectTrigger>
                <SelectValue placeholder="Select interface" />
              </SelectTrigger>
              <SelectContent>
                {interfaceNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="vlan-disabled"
              checked={disabled}
              onCheckedChange={(v) => setDisabled(v === true)}
            />
            <Label htmlFor="vlan-disabled">Disabled</Label>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Add'} Change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Bridges Tab
// ---------------------------------------------------------------------------

interface BridgesTabProps {
  bridges: Record<string, string>[]
  bridgePorts: Record<string, string>[]
  isLoading: boolean
  interfaceNames: string[]
  bridgeNames: string[]
  addChange: (c: ConfigChange) => void
}

function BridgesTab({
  bridges,
  bridgePorts,
  isLoading,
  interfaceNames,
  bridgeNames,
  addChange,
}: BridgesTabProps) {
  const [bridgeDialogOpen, setBridgeDialogOpen] = useState(false)
  const [portDialogOpen, setPortDialogOpen] = useState(false)
  const [editBridge, setEditBridge] = useState<Record<string, string> | null>(null)
  const [editPort, setEditPort] = useState<Record<string, string> | null>(null)

  const openAddBridge = () => {
    setEditBridge(null)
    setBridgeDialogOpen(true)
  }
  const openEditBridge = (entry: Record<string, string>) => {
    setEditBridge(entry)
    setBridgeDialogOpen(true)
  }
  const handleRemoveBridge = (entry: Record<string, string>) => {
    addChange({
      operation: 'remove',
      path: '/interface/bridge',
      entryId: entry['.id'],
      properties: {},
      description: `Remove bridge ${entry.name}`,
    })
  }
  const handleToggleBridge = (entry: Record<string, string>) => {
    const newDisabled = entry.disabled === 'true' ? 'no' : 'yes'
    addChange({
      operation: 'set',
      path: '/interface/bridge',
      entryId: entry['.id'],
      properties: { disabled: newDisabled },
      description: `${newDisabled === 'yes' ? 'Disable' : 'Enable'} bridge ${entry.name}`,
    })
  }

  const openAddPort = () => {
    setEditPort(null)
    setPortDialogOpen(true)
  }
  const openEditPort = (entry: Record<string, string>) => {
    setEditPort(entry)
    setPortDialogOpen(true)
  }
  const handleRemovePort = (entry: Record<string, string>) => {
    addChange({
      operation: 'remove',
      path: '/interface/bridge/port',
      entryId: entry['.id'],
      properties: {},
      description: `Remove ${entry.interface} from bridge ${entry.bridge}`,
    })
  }

  if (isLoading) return <TableLoading />

  return (
    <div className="space-y-6">
      {/* Bridges section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary">Bridges</h3>
          <Button variant="outline" size="sm" onClick={openAddBridge} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Bridge
          </Button>
        </div>

        {bridges.length === 0 ? (
          <div className="rounded-lg border border-border bg-panel p-6 text-center text-text-secondary text-sm">
            No bridges configured.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                    Name
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                    Protocol Mode
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-text-secondary">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {bridges.map((entry, i) => {
                  const isDisabled = entry.disabled === 'true'
                  return (
                    <tr key={entry['.id'] || i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {entry.name || '---'}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {entry['protocol-mode'] || '---'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-block h-2 w-2 rounded-full',
                              isDisabled ? 'bg-text-muted' : 'bg-success',
                            )}
                          />
                          <span className="text-text-secondary text-xs">
                            {isDisabled ? 'disabled' : 'active'}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <EntryActions
                          entry={entry}
                          onEdit={openEditBridge}
                          onRemove={handleRemoveBridge}
                          onToggle={handleToggleBridge}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bridge Ports section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary">Bridge Ports</h3>
          <Button variant="outline" size="sm" onClick={openAddPort} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Port
          </Button>
        </div>

        {bridgePorts.length === 0 ? (
          <div className="rounded-lg border border-border bg-panel p-6 text-center text-text-secondary text-sm">
            No bridge ports configured.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                    Interface
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                    Bridge
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">
                    PVID
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-text-secondary">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {bridgePorts.map((entry, i) => (
                  <tr key={entry['.id'] || i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-text-primary">
                      {entry.interface || '---'}
                    </td>
                    <td className="px-3 py-2 text-text-primary">{entry.bridge || '---'}</td>
                    <td className="px-3 py-2 font-mono text-text-secondary">
                      {entry.pvid || '---'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditPort(entry)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleRemovePort(entry)}
                            className="text-error focus:text-error"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <BridgeDialog
        open={bridgeDialogOpen}
        onOpenChange={setBridgeDialogOpen}
        entry={editBridge}
        addChange={addChange}
      />
      <BridgePortDialog
        open={portDialogOpen}
        onOpenChange={setPortDialogOpen}
        entry={editPort}
        interfaceNames={interfaceNames}
        bridgeNames={bridgeNames}
        addChange={addChange}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bridge Dialog
// ---------------------------------------------------------------------------

function BridgeDialog({
  open,
  onOpenChange,
  entry,
  addChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  addChange: (c: ConfigChange) => void
}) {
  const isEdit = !!entry
  const [name, setName] = useState('')
  const [protocolMode, setProtocolMode] = useState('rstp')
  const [error, setError] = useState('')

  const handleOpenChange = (val: boolean) => {
    if (val) {
      setName(entry?.name || '')
      setProtocolMode(entry?.['protocol-mode'] || 'rstp')
      setError('')
    }
    onOpenChange(val)
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Bridge name is required')
      return
    }
    setError('')

    const properties: Record<string, string> = {
      name: name.trim(),
      'protocol-mode': protocolMode,
    }

    if (isEdit) {
      addChange({
        operation: 'set',
        path: '/interface/bridge',
        entryId: entry['.id'],
        properties,
        description: `Update bridge ${name} (${protocolMode})`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/interface/bridge',
        properties,
        description: `Add bridge ${name} (${protocolMode})`,
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Bridge' : 'Add Bridge'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Modify the bridge configuration.' : 'Create a new bridge interface.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bridge-name">Name</Label>
            <Input
              id="bridge-name"
              placeholder="bridge1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bridge-protocol">Protocol Mode</Label>
            <Select value={protocolMode} onValueChange={setProtocolMode}>
              <SelectTrigger>
                <SelectValue placeholder="Select protocol mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rstp">RSTP</SelectItem>
                <SelectItem value="stp">STP</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Add'} Change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Bridge Port Dialog
// ---------------------------------------------------------------------------

function BridgePortDialog({
  open,
  onOpenChange,
  entry,
  interfaceNames,
  bridgeNames,
  addChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  interfaceNames: string[]
  bridgeNames: string[]
  addChange: (c: ConfigChange) => void
}) {
  const isEdit = !!entry
  const [iface, setIface] = useState('')
  const [bridge, setBridge] = useState('')
  const [pvid, setPvid] = useState('1')
  const [error, setError] = useState('')

  const handleOpenChange = (val: boolean) => {
    if (val) {
      setIface(entry?.interface || '')
      setBridge(entry?.bridge || '')
      setPvid(entry?.pvid || '1')
      setError('')
    }
    onOpenChange(val)
  }

  const handleSubmit = () => {
    if (!iface) {
      setError('Please select an interface')
      return
    }
    if (!bridge) {
      setError('Please select a bridge')
      return
    }
    setError('')

    const properties: Record<string, string> = {
      interface: iface,
      bridge,
      pvid,
    }

    if (isEdit) {
      addChange({
        operation: 'set',
        path: '/interface/bridge/port',
        entryId: entry['.id'],
        properties,
        description: `Update bridge port ${iface} on ${bridge} (PVID: ${pvid})`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/interface/bridge/port',
        properties,
        description: `Add ${iface} to bridge ${bridge} (PVID: ${pvid})`,
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Bridge Port' : 'Add Bridge Port'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Modify the bridge port assignment.' : 'Assign an interface to a bridge.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="port-interface">Interface</Label>
            <Select value={iface} onValueChange={setIface}>
              <SelectTrigger>
                <SelectValue placeholder="Select interface" />
              </SelectTrigger>
              <SelectContent>
                {interfaceNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="port-bridge">Bridge</Label>
            <Select value={bridge} onValueChange={setBridge}>
              <SelectTrigger>
                <SelectValue placeholder="Select bridge" />
              </SelectTrigger>
              <SelectContent>
                {bridgeNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="port-pvid">PVID</Label>
            <Input
              id="port-pvid"
              type="number"
              min={1}
              placeholder="1"
              value={pvid}
              onChange={(e) => setPvid(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Add'} Change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Shared Entry Actions Dropdown
// ---------------------------------------------------------------------------

function EntryActions({
  entry,
  onEdit,
  onRemove,
  onToggle,
}: {
  entry: Record<string, string>
  onEdit: (entry: Record<string, string>) => void
  onRemove: (entry: Record<string, string>) => void
  onToggle: (entry: Record<string, string>) => void
}) {
  const isDisabled = entry.disabled === 'true'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(entry)}>
          <Pencil className="h-3.5 w-3.5 mr-2" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onToggle(entry)}>
          {isDisabled ? (
            <>
              <ToggleRight className="h-3.5 w-3.5 mr-2" />
              Enable
            </>
          ) : (
            <>
              <ToggleLeft className="h-3.5 w-3.5 mr-2" />
              Disable
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onRemove(entry)}
          className="text-error focus:text-error"
        >
          <Trash2 className="h-3.5 w-3.5 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
