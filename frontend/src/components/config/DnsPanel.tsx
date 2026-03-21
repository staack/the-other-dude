/**
 * DnsPanel -- DNS configuration panel for device management.
 *
 * Provides:
 * 1. Resolver settings (upstream servers, allow-remote-requests, cache-size, max-udp-packet-size)
 * 2. Static DNS entries (add/edit/delete name/address/type/TTL)
 * 3. Read-only cache usage info
 *
 * All operations flow through useConfigPanel for pending changes and apply workflow.
 */

import { useState, useCallback } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Globe,
  Server,
  Info,
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
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'] as const

interface StaticEntry {
  '.id': string
  name: string
  address: string
  type: string
  ttl: string
  disabled: string
  [key: string]: string
}

interface StaticFormState {
  name: string
  address: string
  type: string
  ttl: string
  disabled: boolean
}

const EMPTY_FORM: StaticFormState = {
  name: '',
  address: '',
  type: 'A',
  ttl: '',
  disabled: false,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidIp(value: string): boolean {
  // Basic IPv4/IPv6 validation
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
  const ipv6 = /^[0-9a-fA-F:]+$/
  return ipv4.test(value) || ipv6.test(value)
}

// ---------------------------------------------------------------------------
// DnsPanel
// ---------------------------------------------------------------------------

export function DnsPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  // Data loading
  const dnsSettings = useConfigBrowse(tenantId, deviceId, '/ip/dns', {
    enabled: active,
  })
  const staticEntries = useConfigBrowse(tenantId, deviceId, '/ip/dns/static', {
    enabled: active,
  })

  // Config panel state
  const panel = useConfigPanel(tenantId, deviceId, 'dns')

  // Preview modal
  const [previewOpen, setPreviewOpen] = useState(false)

  // Static entry dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<StaticEntry | null>(null)
  const [form, setForm] = useState<StaticFormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Local state for resolver settings edits
  const settings = dnsSettings.entries[0] as Record<string, string> | undefined
  const [editedServers, setEditedServers] = useState<string | null>(null)
  const [editedAllowRemote, setEditedAllowRemote] = useState<string | null>(null)
  const [editedMaxUdp, setEditedMaxUdp] = useState<string | null>(null)
  const [editedCacheSize, setEditedCacheSize] = useState<string | null>(null)

  // Derived values -- use edited state if set, otherwise fall back to server data
  const currentServers = editedServers ?? settings?.servers ?? ''
  const currentAllowRemote = editedAllowRemote ?? settings?.['allow-remote-requests'] ?? 'false'
  const currentMaxUdp = editedMaxUdp ?? settings?.['max-udp-packet-size'] ?? '4096'
  const currentCacheSize = editedCacheSize ?? settings?.['cache-size'] ?? '2048'
  const cacheUsed = settings?.['cache-used'] ?? '0'

  // Check if resolver settings have been modified
  const settingsModified =
    editedServers !== null ||
    editedAllowRemote !== null ||
    editedMaxUdp !== null ||
    editedCacheSize !== null

  // Save resolver settings
  const handleSaveSettings = useCallback(() => {
    const props: Record<string, string> = {}

    if (editedServers !== null) props.servers = editedServers
    if (editedAllowRemote !== null) props['allow-remote-requests'] = editedAllowRemote
    if (editedMaxUdp !== null) props['max-udp-packet-size'] = editedMaxUdp
    if (editedCacheSize !== null) props['cache-size'] = editedCacheSize

    if (Object.keys(props).length === 0) return

    const descParts: string[] = []
    if (props.servers !== undefined) descParts.push(`servers=${props.servers}`)
    if (props['allow-remote-requests'] !== undefined)
      descParts.push(`allow-remote-requests=${props['allow-remote-requests']}`)
    if (props['max-udp-packet-size'] !== undefined)
      descParts.push(`max-udp-packet-size=${props['max-udp-packet-size']}`)
    if (props['cache-size'] !== undefined)
      descParts.push(`cache-size=${props['cache-size']}`)

    panel.addChange({
      operation: 'set',
      path: '/ip/dns',
      entryId: settings?.['.id'],
      properties: props,
      description: `Update DNS resolver: ${descParts.join(', ')}`,
    })

    // Reset edited state
    setEditedServers(null)
    setEditedAllowRemote(null)
    setEditedMaxUdp(null)
    setEditedCacheSize(null)
  }, [
    editedServers,
    editedAllowRemote,
    editedMaxUdp,
    editedCacheSize,
    settings,
    panel,
  ])

  // Static entry form validation
  const validateForm = useCallback((f: StaticFormState): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!f.name.trim()) errors.name = 'Name is required'
    if (!f.address.trim()) errors.address = 'Address is required'
    else if (f.type === 'A' || f.type === 'AAAA') {
      if (!isValidIp(f.address)) errors.address = 'Invalid IP address'
    }
    return errors
  }, [])

  // Open add dialog
  const handleAdd = useCallback(() => {
    setEditingEntry(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setDialogOpen(true)
  }, [])

  // Open edit dialog
  const handleEdit = useCallback((entry: StaticEntry) => {
    setEditingEntry(entry)
    setForm({
      name: entry.name || '',
      address: entry.address || '',
      type: entry.type || 'A',
      ttl: entry.ttl || '',
      disabled: entry.disabled === 'true',
    })
    setFormErrors({})
    setDialogOpen(true)
  }, [])

  // Delete entry
  const handleDelete = useCallback(
    (entry: StaticEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/ip/dns/static',
        entryId: entry['.id'],
        properties: {},
        description: `Delete static DNS: ${entry.name} -> ${entry.address}`,
      })
    },
    [panel],
  )

  // Submit static entry form
  const handleSubmitEntry = useCallback(() => {
    const errors = validateForm(form)
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    const props: Record<string, string> = {
      name: form.name.trim(),
      address: form.address.trim(),
      type: form.type,
    }
    if (form.ttl.trim()) props.ttl = form.ttl.trim()
    if (form.disabled) props.disabled = 'true'

    if (editingEntry) {
      panel.addChange({
        operation: 'set',
        path: '/ip/dns/static',
        entryId: editingEntry['.id'],
        properties: props,
        description: `Edit static DNS: ${form.name} -> ${form.address}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/dns/static',
        properties: props,
        description: `Add static DNS: ${form.name} -> ${form.address} (${form.type})`,
      })
    }

    setDialogOpen(false)
  }, [form, editingEntry, validateForm, panel])

  // Loading state
  if (dnsSettings.isLoading || staticEntries.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading DNS configuration...
      </div>
    )
  }

  // Error state
  if (dnsSettings.error || staticEntries.error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load DNS configuration.{' '}
        <button
          className="underline ml-1"
          onClick={() => {
            dnsSettings.refetch()
            staticEntries.refetch()
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const entries = staticEntries.entries as StaticEntry[]

  return (
    <div className="space-y-6">
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

      {/* Section 1: Resolver Settings */}
      <div className="rounded-lg border border-border bg-panel p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">Resolver Settings</h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="text-xs bg-info/10 text-info px-2 py-0.5 rounded border-0">
              <Info className="h-3 w-3 mr-1" />
              Cache Used: {cacheUsed} KiB
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={!settingsModified}
              onClick={handleSaveSettings}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              Save Settings
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Servers */}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="dns-servers" className="text-xs text-text-secondary">
              Upstream DNS Servers
            </Label>
            <Input
              id="dns-servers"
              value={currentServers}
              onChange={(e) => setEditedServers(e.target.value)}
              placeholder="8.8.8.8,8.8.4.4"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">Comma-separated list of DNS server IPs</p>
          </div>

          {/* Allow Remote Requests */}
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Allow Remote Requests</Label>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="dns-allow-remote"
                checked={currentAllowRemote === 'true' || currentAllowRemote === 'yes'}
                onCheckedChange={(checked) =>
                  setEditedAllowRemote(checked ? 'yes' : 'no')
                }
              />
              <Label htmlFor="dns-allow-remote" className="text-sm text-text-primary cursor-pointer">
                Allow this router to be used as a DNS server
              </Label>
            </div>
          </div>

          {/* Max UDP Packet Size */}
          <div className="space-y-1">
            <Label htmlFor="dns-max-udp" className="text-xs text-text-secondary">
              Max UDP Packet Size
            </Label>
            <Input
              id="dns-max-udp"
              type="number"
              value={currentMaxUdp}
              onChange={(e) => setEditedMaxUdp(e.target.value)}
              min={512}
              max={65535}
              className="text-sm"
            />
          </div>

          {/* Cache Size */}
          <div className="space-y-1">
            <Label htmlFor="dns-cache-size" className="text-xs text-text-secondary">
              Cache Size (KiB)
            </Label>
            <Input
              id="dns-cache-size"
              type="number"
              value={currentCacheSize}
              onChange={(e) => setEditedCacheSize(e.target.value)}
              min={0}
              className="text-sm"
            />
          </div>
        </div>
      </div>

      {/* Section 2: Static DNS Entries */}
      <div className="rounded-lg border border-border bg-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">Static DNS Entries</h3>
          </div>
          <Button variant="outline" size="sm" onClick={handleAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Entry
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="text-center py-8 text-text-secondary text-sm">
            No static DNS entries configured.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-xs">
                  <th className="text-left py-2 px-3 font-medium">Name</th>
                  <th className="text-left py-2 px-3 font-medium">Address</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                  <th className="text-left py-2 px-3 font-medium">TTL</th>
                  <th className="text-left py-2 px-3 font-medium">Disabled</th>
                  <th className="text-right py-2 px-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry['.id']}
                    className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
                  >
                    <td className="py-2 px-3 font-mono text-text-primary">
                      {entry.name}
                    </td>
                    <td className="py-2 px-3 font-mono text-text-primary">
                      {entry.address}
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="text-xs">
                        {entry.type || 'A'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-text-secondary">
                      {entry.ttl || '-'}
                    </td>
                    <td className="py-2 px-3">
                      {entry.disabled === 'true' ? (
                        <Badge className="text-xs bg-warning/10 text-warning border-0">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-text-muted text-xs">No</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                          className="h-7 w-7 p-0"
                        >
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
      </div>

      {/* Static DNS Entry Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? 'Edit Static DNS Entry' : 'Add Static DNS Entry'}
            </DialogTitle>
            <DialogDescription>
              {editingEntry
                ? 'Modify the DNS record properties.'
                : 'Create a new static DNS record.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-1">
              <Label htmlFor="static-name" className="text-xs text-text-secondary">
                Name <span className="text-error">*</span>
              </Label>
              <Input
                id="static-name"
                value={form.name}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }))
                  setFormErrors((prev) => ({ ...prev, name: '' }))
                }}
                placeholder="myserver.local"
                className={formErrors.name ? 'border-error' : ''}
              />
              {formErrors.name && (
                <p className="text-xs text-error">{formErrors.name}</p>
              )}
            </div>

            {/* Address */}
            <div className="space-y-1">
              <Label htmlFor="static-address" className="text-xs text-text-secondary">
                Address <span className="text-error">*</span>
              </Label>
              <Input
                id="static-address"
                value={form.address}
                onChange={(e) => {
                  setForm((f) => ({ ...f, address: e.target.value }))
                  setFormErrors((prev) => ({ ...prev, address: '' }))
                }}
                placeholder="192.168.1.100"
                className={formErrors.address ? 'border-error' : ''}
              />
              {formErrors.address && (
                <p className="text-xs text-error">{formErrors.address}</p>
              )}
            </div>

            {/* Type */}
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Type</Label>
              <Select
                value={form.type}
                onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DNS_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* TTL */}
            <div className="space-y-1">
              <Label htmlFor="static-ttl" className="text-xs text-text-secondary">
                TTL
              </Label>
              <Input
                id="static-ttl"
                value={form.ttl}
                onChange={(e) => setForm((f) => ({ ...f, ttl: e.target.value }))}
                placeholder="1d (optional)"
              />
              <p className="text-xs text-text-muted">
                Examples: 1d, 1h, 300s, or leave blank for default
              </p>
            </div>

            {/* Disabled */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="static-disabled"
                checked={form.disabled}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, disabled: !!checked }))
                }
              />
              <Label htmlFor="static-disabled" className="text-sm text-text-primary cursor-pointer">
                Disabled
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitEntry}>
              {editingEntry ? 'Update Entry' : 'Add Entry'}
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
