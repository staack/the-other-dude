/**
 * DhcpPanel -- DHCP management panel for device configuration.
 *
 * Provides 4 sub-tabs:
 * 1. Servers -- DHCP server instances (add/edit/delete/enable/disable)
 * 2. Pools -- Address pool ranges (add/edit/delete)
 * 3. Leases -- Active leases with make-static and static reservations
 * 4. Networks -- DHCP network settings (add/edit/delete)
 *
 * All operations flow through useConfigPanel for pending changes and apply workflow.
 */

import { useState, useCallback } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Server,
  Layers,
  Network,
  Wifi,
  Pin,
} from 'lucide-react'
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
// Sub-tab types
// ---------------------------------------------------------------------------

type SubTab = 'servers' | 'pools' | 'leases' | 'networks'

interface SubTabConfig {
  key: SubTab
  label: string
  icon: React.ReactNode
}

const SUB_TABS: SubTabConfig[] = [
  { key: 'servers', label: 'Servers', icon: <Server className="h-3.5 w-3.5" /> },
  { key: 'pools', label: 'Pools', icon: <Layers className="h-3.5 w-3.5" /> },
  { key: 'leases', label: 'Leases', icon: <Wifi className="h-3.5 w-3.5" /> },
  { key: 'networks', label: 'Networks', icon: <Network className="h-3.5 w-3.5" /> },
]

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

interface DhcpServer {
  '.id': string
  name: string
  interface: string
  'address-pool': string
  'lease-time': string
  disabled: string
  [key: string]: string
}

interface AddressPool {
  '.id': string
  name: string
  ranges: string
  [key: string]: string
}

interface DhcpLease {
  '.id': string
  address: string
  'mac-address': string
  'host-name': string
  status: string
  'expires-after': string
  server: string
  [key: string]: string
}

interface DhcpNetwork {
  '.id': string
  address: string
  gateway: string
  'dns-server': string
  domain: string
  [key: string]: string
}

// ---------------------------------------------------------------------------
// Form types
// ---------------------------------------------------------------------------

interface ServerForm {
  name: string
  interface: string
  'address-pool': string
  'lease-time': string
  disabled: boolean
}

interface PoolForm {
  name: string
  ranges: string
}

interface LeaseForm {
  address: string
  'mac-address': string
  server: string
  comment: string
}

interface NetworkForm {
  address: string
  gateway: string
  'dns-server': string
  domain: string
}

const EMPTY_SERVER: ServerForm = {
  name: '',
  interface: '',
  'address-pool': '',
  'lease-time': '1d',
  disabled: false,
}

const EMPTY_POOL: PoolForm = { name: '', ranges: '' }
const EMPTY_LEASE: LeaseForm = { address: '', 'mac-address': '', server: '', comment: '' }
const EMPTY_NETWORK: NetworkForm = { address: '', gateway: '', 'dns-server': '', domain: '' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidIp(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value)
}

function isValidCidr(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value)
}

function isValidMac(value: string): boolean {
  return /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(value)
}

// ---------------------------------------------------------------------------
// DhcpPanel
// ---------------------------------------------------------------------------

export function DhcpPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('servers')

  // Data loading
  const servers = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-server', {
    enabled: active,
  })
  const pools = useConfigBrowse(tenantId, deviceId, '/ip/pool', {
    enabled: active,
  })
  const leases = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-server/lease', {
    enabled: active,
  })
  const networks = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-server/network', {
    enabled: active,
  })

  // Config panel state
  const panel = useConfigPanel(tenantId, deviceId, 'dhcp')

  // Preview modal
  const [previewOpen, setPreviewOpen] = useState(false)

  // Loading state
  const isLoading = servers.isLoading || pools.isLoading || leases.isLoading || networks.isLoading
  const hasError = servers.error || pools.error || leases.error || networks.error

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading DHCP configuration...
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load DHCP configuration.{' '}
        <button
          className="underline ml-1"
          onClick={() => {
            servers.refetch()
            pools.refetch()
            leases.refetch()
            networks.refetch()
          }}
        >
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

      {/* Sub-tab navigation */}
      <div className="flex gap-1 p-1 rounded-lg bg-elevated">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface/50',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'servers' && (
        <ServersTab
          entries={servers.entries as DhcpServer[]}
          panel={panel}
        />
      )}
      {activeTab === 'pools' && (
        <PoolsTab
          entries={pools.entries as AddressPool[]}
          panel={panel}
        />
      )}
      {activeTab === 'leases' && (
        <LeasesTab
          entries={leases.entries as DhcpLease[]}
          serverList={servers.entries as DhcpServer[]}
          panel={panel}
        />
      )}
      {activeTab === 'networks' && (
        <NetworksTab
          entries={networks.entries as DhcpNetwork[]}
          panel={panel}
        />
      )}

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
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// Servers Tab
// ---------------------------------------------------------------------------

function ServersTab({
  entries,
  panel,
}: {
  entries: DhcpServer[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<DhcpServer | null>(null)
  const [form, setForm] = useState<ServerForm>(EMPTY_SERVER)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_SERVER)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: DhcpServer) => {
    setEditing(entry)
    setForm({
      name: entry.name || '',
      interface: entry.interface || '',
      'address-pool': entry['address-pool'] || '',
      'lease-time': entry['lease-time'] || '1d',
      disabled: entry.disabled === 'true',
    })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleToggleDisable = useCallback(
    (entry: DhcpServer) => {
      const newState = entry.disabled === 'true' ? 'false' : 'true'
      panel.addChange({
        operation: 'set',
        path: '/ip/dhcp-server',
        entryId: entry['.id'],
        properties: { disabled: newState },
        description: `${newState === 'true' ? 'Disable' : 'Enable'} DHCP server "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleDelete = useCallback(
    (entry: DhcpServer) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/dhcp-server',
        entryId: entry['.id'],
        properties: {},
        description: `Delete DHCP server "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSubmit = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.interface.trim()) errs.interface = 'Interface is required'
    if (!form['address-pool'].trim()) errs['address-pool'] = 'Address pool is required'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const props: Record<string, string> = {
      name: form.name.trim(),
      interface: form.interface.trim(),
      'address-pool': form['address-pool'].trim(),
      'lease-time': form['lease-time'].trim() || '1d',
    }
    if (form.disabled) props.disabled = 'true'

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/ip/dhcp-server',
        entryId: editing['.id'],
        properties: props,
        description: `Edit DHCP server "${form.name}" on ${form.interface}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/dhcp-server',
        properties: props,
        description: `Add DHCP server "${form.name}" on ${form.interface} (pool: ${form['address-pool']})`,
      })
    }
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">DHCP Servers</h3>
        <Button variant="outline" size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Server
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          No DHCP servers configured.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-xs">
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Interface</th>
                <th className="text-left py-2 px-3 font-medium">Address Pool</th>
                <th className="text-left py-2 px-3 font-medium">Lease Time</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry['.id']}
                  className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
                >
                  <td className="py-2 px-3 font-medium text-text-primary">{entry.name}</td>
                  <td className="py-2 px-3 font-mono text-text-primary">{entry.interface}</td>
                  <td className="py-2 px-3 text-text-primary">{entry['address-pool']}</td>
                  <td className="py-2 px-3 text-text-secondary">{entry['lease-time']}</td>
                  <td className="py-2 px-3">
                    {entry.disabled === 'true' ? (
                      <Badge className="text-xs bg-warning/10 text-warning border-0">Disabled</Badge>
                    ) : (
                      <Badge className="text-xs bg-success/10 text-success border-0">Active</Badge>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(entry)} className="h-7 w-7 p-0">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleDisable(entry)}
                        className="h-7 px-2 text-xs"
                      >
                        {entry.disabled === 'true' ? 'Enable' : 'Disable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        className="h-7 w-7 p-0 text-error hover:text-error"
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

      {/* Server Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit DHCP Server' : 'Add DHCP Server'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Modify server settings.' : 'Create a new DHCP server instance.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="srv-name" className="text-xs text-text-secondary">
                Name <span className="text-error">*</span>
              </Label>
              <Input
                id="srv-name"
                value={form.name}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }))
                  setErrors((prev) => ({ ...prev, name: '' }))
                }}
                placeholder="dhcp1"
                className={errors.name ? 'border-error' : ''}
              />
              {errors.name && <p className="text-xs text-error">{errors.name}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="srv-iface" className="text-xs text-text-secondary">
                Interface <span className="text-error">*</span>
              </Label>
              <Input
                id="srv-iface"
                value={form.interface}
                onChange={(e) => {
                  setForm((f) => ({ ...f, interface: e.target.value }))
                  setErrors((prev) => ({ ...prev, interface: '' }))
                }}
                placeholder="bridge1"
                className={errors.interface ? 'border-error' : ''}
              />
              {errors.interface && <p className="text-xs text-error">{errors.interface}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="srv-pool" className="text-xs text-text-secondary">
                Address Pool <span className="text-error">*</span>
              </Label>
              <Input
                id="srv-pool"
                value={form['address-pool']}
                onChange={(e) => {
                  setForm((f) => ({ ...f, 'address-pool': e.target.value }))
                  setErrors((prev) => ({ ...prev, 'address-pool': '' }))
                }}
                placeholder="pool1"
                className={errors['address-pool'] ? 'border-error' : ''}
              />
              {errors['address-pool'] && (
                <p className="text-xs text-error">{errors['address-pool']}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="srv-lease" className="text-xs text-text-secondary">
                Lease Time
              </Label>
              <Input
                id="srv-lease"
                value={form['lease-time']}
                onChange={(e) => setForm((f) => ({ ...f, 'lease-time': e.target.value }))}
                placeholder="1d"
              />
              <p className="text-xs text-text-muted">Examples: 1h, 12h, 1d, 3d</p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="srv-disabled"
                checked={form.disabled}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, disabled: !!checked }))
                }
              />
              <Label htmlFor="srv-disabled" className="text-sm text-text-primary cursor-pointer">
                Disabled
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editing ? 'Update Server' : 'Add Server'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pools Tab
// ---------------------------------------------------------------------------

function PoolsTab({
  entries,
  panel,
}: {
  entries: AddressPool[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AddressPool | null>(null)
  const [form, setForm] = useState<PoolForm>(EMPTY_POOL)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_POOL)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: AddressPool) => {
    setEditing(entry)
    setForm({ name: entry.name || '', ranges: entry.ranges || '' })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: AddressPool) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/pool',
        entryId: entry['.id'],
        properties: {},
        description: `Delete address pool "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSubmit = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.ranges.trim()) errs.ranges = 'Range is required'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const props: Record<string, string> = {
      name: form.name.trim(),
      ranges: form.ranges.trim(),
    }

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/ip/pool',
        entryId: editing['.id'],
        properties: props,
        description: `Edit pool "${form.name}" ranges: ${form.ranges}`,
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
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Address Pools</h3>
        <Button variant="outline" size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Pool
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          No address pools configured.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-xs">
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Ranges</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry['.id']}
                  className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
                >
                  <td className="py-2 px-3 font-medium text-text-primary">{entry.name}</td>
                  <td className="py-2 px-3 font-mono text-text-primary">{entry.ranges}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(entry)} className="h-7 w-7 p-0">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        className="h-7 w-7 p-0 text-error hover:text-error"
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

      {/* Pool Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Address Pool' : 'Add Address Pool'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Modify the pool range.' : 'Define a new IP address pool.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="pool-name" className="text-xs text-text-secondary">
                Name <span className="text-error">*</span>
              </Label>
              <Input
                id="pool-name"
                value={form.name}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }))
                  setErrors((prev) => ({ ...prev, name: '' }))
                }}
                placeholder="pool1"
                className={errors.name ? 'border-error' : ''}
              />
              {errors.name && <p className="text-xs text-error">{errors.name}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="pool-ranges" className="text-xs text-text-secondary">
                Ranges <span className="text-error">*</span>
              </Label>
              <Input
                id="pool-ranges"
                value={form.ranges}
                onChange={(e) => {
                  setForm((f) => ({ ...f, ranges: e.target.value }))
                  setErrors((prev) => ({ ...prev, ranges: '' }))
                }}
                placeholder="192.168.1.100-192.168.1.200"
                className={cn('font-mono', errors.ranges ? 'border-error' : '')}
              />
              {errors.ranges && <p className="text-xs text-error">{errors.ranges}</p>}
              <p className="text-xs text-text-muted">
                Format: start-end (e.g. 192.168.1.100-192.168.1.200)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editing ? 'Update Pool' : 'Add Pool'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leases Tab
// ---------------------------------------------------------------------------

function LeasesTab({
  entries,
  serverList,
  panel,
}: {
  entries: DhcpLease[]
  serverList: DhcpServer[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<LeaseForm>(EMPTY_LEASE)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAddStatic = useCallback(() => {
    setForm(EMPTY_LEASE)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleMakeStatic = useCallback(
    (lease: DhcpLease) => {
      panel.addChange({
        operation: 'set',
        path: '/ip/dhcp-server/lease',
        entryId: lease['.id'],
        properties: { 'make-static': '' },
        description: `Make static reservation: ${lease.address} (${lease['mac-address']})`,
      })
    },
    [panel],
  )

  const handleDelete = useCallback(
    (lease: DhcpLease) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/dhcp-server/lease',
        entryId: lease['.id'],
        properties: {},
        description: `Delete lease: ${lease.address} (${lease['mac-address']})`,
      })
    },
    [panel],
  )

  const handleSubmit = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!form.address.trim()) errs.address = 'Address is required'
    else if (!isValidIp(form.address.trim())) errs.address = 'Invalid IP address'
    if (!form['mac-address'].trim()) errs['mac-address'] = 'MAC address is required'
    else if (!isValidMac(form['mac-address'].trim()))
      errs['mac-address'] = 'Invalid MAC address (e.g. AA:BB:CC:DD:EE:FF)'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const props: Record<string, string> = {
      address: form.address.trim(),
      'mac-address': form['mac-address'].trim(),
    }
    if (form.server.trim()) props.server = form.server.trim()
    if (form.comment.trim()) props.comment = form.comment.trim()

    panel.addChange({
      operation: 'add',
      path: '/ip/dhcp-server/lease',
      properties: props,
      description: `Add static reservation: ${form.address} -> ${form['mac-address']}`,
    })
    setDialogOpen(false)
  }, [form, panel])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'bound':
        return (
          <Badge className="text-xs bg-success/10 text-success border-0">bound</Badge>
        )
      case 'waiting':
        return (
          <Badge className="text-xs bg-warning/10 text-warning border-0">waiting</Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-xs">
            {status || 'unknown'}
          </Badge>
        )
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">DHCP Leases</h3>
        <Button variant="outline" size="sm" onClick={handleAddStatic} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Static Reservation
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          No active DHCP leases.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-xs">
                <th className="text-left py-2 px-3 font-medium">Address</th>
                <th className="text-left py-2 px-3 font-medium">MAC Address</th>
                <th className="text-left py-2 px-3 font-medium">Hostname</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-left py-2 px-3 font-medium">Expires</th>
                <th className="text-left py-2 px-3 font-medium">Server</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((lease) => (
                <tr
                  key={lease['.id']}
                  className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
                >
                  <td className="py-2 px-3 font-mono text-text-primary">{lease.address}</td>
                  <td className="py-2 px-3 font-mono text-text-primary text-xs">
                    {lease['mac-address']}
                  </td>
                  <td className="py-2 px-3 text-text-primary">
                    {lease['host-name'] || <span className="text-text-muted">-</span>}
                  </td>
                  <td className="py-2 px-3">{getStatusBadge(lease.status)}</td>
                  <td className="py-2 px-3 text-text-secondary text-xs">
                    {lease['expires-after'] || '-'}
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{lease.server || '-'}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {lease.status === 'bound' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleMakeStatic(lease)}
                          className="h-7 px-2 text-xs gap-1"
                        >
                          <Pin className="h-3 w-3" />
                          Make Static
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(lease)}
                        className="h-7 w-7 p-0 text-error hover:text-error"
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

      {/* Static Reservation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Static Reservation</DialogTitle>
            <DialogDescription>
              Create a static DHCP lease binding an IP to a MAC address.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="lease-addr" className="text-xs text-text-secondary">
                Address <span className="text-error">*</span>
              </Label>
              <Input
                id="lease-addr"
                value={form.address}
                onChange={(e) => {
                  setForm((f) => ({ ...f, address: e.target.value }))
                  setErrors((prev) => ({ ...prev, address: '' }))
                }}
                placeholder="192.168.1.50"
                className={errors.address ? 'border-error' : ''}
              />
              {errors.address && <p className="text-xs text-error">{errors.address}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="lease-mac" className="text-xs text-text-secondary">
                MAC Address <span className="text-error">*</span>
              </Label>
              <Input
                id="lease-mac"
                value={form['mac-address']}
                onChange={(e) => {
                  setForm((f) => ({ ...f, 'mac-address': e.target.value }))
                  setErrors((prev) => ({ ...prev, 'mac-address': '' }))
                }}
                placeholder="AA:BB:CC:DD:EE:FF"
                className={cn('font-mono', errors['mac-address'] ? 'border-error' : '')}
              />
              {errors['mac-address'] && (
                <p className="text-xs text-error">{errors['mac-address']}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="lease-server" className="text-xs text-text-secondary">
                Server
              </Label>
              <Input
                id="lease-server"
                value={form.server}
                onChange={(e) => setForm((f) => ({ ...f, server: e.target.value }))}
                placeholder={
                  serverList.length > 0
                    ? `e.g. ${serverList[0].name}`
                    : 'dhcp1'
                }
              />
              {serverList.length > 0 && (
                <p className="text-xs text-text-muted">
                  Available: {serverList.map((s) => s.name).join(', ')}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="lease-comment" className="text-xs text-text-secondary">
                Comment
              </Label>
              <Input
                id="lease-comment"
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="Printer, NAS, etc."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>Add Reservation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Networks Tab
// ---------------------------------------------------------------------------

function NetworksTab({
  entries,
  panel,
}: {
  entries: DhcpNetwork[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<DhcpNetwork | null>(null)
  const [form, setForm] = useState<NetworkForm>(EMPTY_NETWORK)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_NETWORK)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: DhcpNetwork) => {
    setEditing(entry)
    setForm({
      address: entry.address || '',
      gateway: entry.gateway || '',
      'dns-server': entry['dns-server'] || '',
      domain: entry.domain || '',
    })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: DhcpNetwork) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/dhcp-server/network',
        entryId: entry['.id'],
        properties: {},
        description: `Delete DHCP network ${entry.address}`,
      })
    },
    [panel],
  )

  const handleSubmit = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!form.address.trim()) errs.address = 'Address is required'
    else if (!isValidCidr(form.address.trim())) errs.address = 'Must be CIDR format (e.g. 192.168.1.0/24)'
    if (!form.gateway.trim()) errs.gateway = 'Gateway is required'
    else if (!isValidIp(form.gateway.trim())) errs.gateway = 'Invalid IP address'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const props: Record<string, string> = {
      address: form.address.trim(),
      gateway: form.gateway.trim(),
    }
    if (form['dns-server'].trim()) props['dns-server'] = form['dns-server'].trim()
    if (form.domain.trim()) props.domain = form.domain.trim()

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/ip/dhcp-server/network',
        entryId: editing['.id'],
        properties: props,
        description: `Edit DHCP network ${form.address} (gw: ${form.gateway})`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/dhcp-server/network',
        properties: props,
        description: `Add DHCP network ${form.address} (gw: ${form.gateway})`,
      })
    }
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">DHCP Networks</h3>
        <Button variant="outline" size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Network
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          No DHCP networks configured.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-xs">
                <th className="text-left py-2 px-3 font-medium">Address</th>
                <th className="text-left py-2 px-3 font-medium">Gateway</th>
                <th className="text-left py-2 px-3 font-medium">DNS Server</th>
                <th className="text-left py-2 px-3 font-medium">Domain</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry['.id']}
                  className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
                >
                  <td className="py-2 px-3 font-mono text-text-primary">{entry.address}</td>
                  <td className="py-2 px-3 font-mono text-text-primary">{entry.gateway}</td>
                  <td className="py-2 px-3 font-mono text-text-secondary">
                    {entry['dns-server'] || '-'}
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{entry.domain || '-'}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(entry)} className="h-7 w-7 p-0">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        className="h-7 w-7 p-0 text-error hover:text-error"
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

      {/* Network Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit DHCP Network' : 'Add DHCP Network'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Modify network settings for DHCP clients.'
                : 'Define gateway, DNS, and domain for DHCP clients.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="net-addr" className="text-xs text-text-secondary">
                Address <span className="text-error">*</span>
              </Label>
              <Input
                id="net-addr"
                value={form.address}
                onChange={(e) => {
                  setForm((f) => ({ ...f, address: e.target.value }))
                  setErrors((prev) => ({ ...prev, address: '' }))
                }}
                placeholder="192.168.1.0/24"
                className={cn('font-mono', errors.address ? 'border-error' : '')}
              />
              {errors.address && <p className="text-xs text-error">{errors.address}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="net-gw" className="text-xs text-text-secondary">
                Gateway <span className="text-error">*</span>
              </Label>
              <Input
                id="net-gw"
                value={form.gateway}
                onChange={(e) => {
                  setForm((f) => ({ ...f, gateway: e.target.value }))
                  setErrors((prev) => ({ ...prev, gateway: '' }))
                }}
                placeholder="192.168.1.1"
                className={cn('font-mono', errors.gateway ? 'border-error' : '')}
              />
              {errors.gateway && <p className="text-xs text-error">{errors.gateway}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="net-dns" className="text-xs text-text-secondary">
                DNS Server
              </Label>
              <Input
                id="net-dns"
                value={form['dns-server']}
                onChange={(e) => setForm((f) => ({ ...f, 'dns-server': e.target.value }))}
                placeholder="192.168.1.1,8.8.8.8"
                className="font-mono"
              />
              <p className="text-xs text-text-muted">Comma-separated IP addresses</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="net-domain" className="text-xs text-text-secondary">
                Domain
              </Label>
              <Input
                id="net-domain"
                value={form.domain}
                onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                placeholder="local"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editing ? 'Update Network' : 'Add Network'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
