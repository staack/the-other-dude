/**
 * DnsSimplePanel -- Simplified DNS configuration for Simple mode.
 *
 * Manages upstream servers, allow-remote-requests toggle, and static DNS entries.
 * Simpler than the Standard DnsPanel: no TTL, no MX/TXT types, no advanced settings.
 */

import { useState } from 'react'
import { Server, Globe, Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { SimpleFormField } from '../SimpleFormField'
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

const DNS_TYPES = ['A', 'AAAA', 'CNAME'] as const

interface StaticFormState {
  name: string
  address: string
  type: string
}

const EMPTY_STATIC: StaticFormState = { name: '', address: '', type: 'A' }

export function DnsSimplePanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const dnsSettings = useConfigBrowse(tenantId, deviceId, '/ip/dns', { enabled: active })
  const staticEntries = useConfigBrowse(tenantId, deviceId, '/ip/dns/static', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-dns')
  const [previewOpen, setPreviewOpen] = useState(false)

  // DNS settings form
  const settings = dnsSettings.entries[0]
  const [editedServers, setEditedServers] = useState<string | null>(null)
  const [editedRemote, setEditedRemote] = useState<string | null>(null)
  const [editedCacheSize, setEditedCacheSize] = useState<string | null>(null)

  const currentServers = editedServers ?? settings?.servers ?? ''
  const currentRemote = editedRemote ?? settings?.['allow-remote-requests'] ?? 'false'
  const currentCacheSize = editedCacheSize ?? settings?.['cache-size'] ?? ''

  // Static entry dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [staticForm, setStaticForm] = useState<StaticFormState>(EMPTY_STATIC)

  const isLoading = dnsSettings.isLoading || staticEntries.isLoading

  const stageResolverChanges = () => {
    const props: Record<string, string> = {}
    if (editedServers !== null) props.servers = editedServers
    if (editedRemote !== null) props['allow-remote-requests'] = editedRemote
    if (editedCacheSize !== null) props['cache-size'] = editedCacheSize

    if (Object.keys(props).length > 0) {
      panel.addChange({
        operation: 'set',
        path: '/ip/dns',
        entryId: settings?.['.id'],
        properties: props,
        description: `Update DNS settings${editedServers !== null ? ` (servers: ${editedServers})` : ''}`,
      })
      setEditedServers(null)
      setEditedRemote(null)
      setEditedCacheSize(null)
    }
  }

  const openAddDialog = () => {
    setEditingId(null)
    setStaticForm(EMPTY_STATIC)
    setDialogOpen(true)
  }

  const openEditDialog = (entry: Record<string, string>) => {
    setEditingId(entry['.id'])
    setStaticForm({
      name: entry.name ?? '',
      address: entry.address ?? '',
      type: entry.type ?? 'A',
    })
    setDialogOpen(true)
  }

  const handleStaticSave = () => {
    const props: Record<string, string> = {
      name: staticForm.name,
      address: staticForm.address,
      type: staticForm.type,
    }

    if (editingId) {
      panel.addChange({
        operation: 'set',
        path: '/ip/dns/static',
        entryId: editingId,
        properties: props,
        description: `Update DNS entry: ${staticForm.name} -> ${staticForm.address}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/dns/static',
        properties: props,
        description: `Add DNS entry: ${staticForm.name} -> ${staticForm.address}`,
      })
    }

    setDialogOpen(false)
    setStaticForm(EMPTY_STATIC)
    setEditingId(null)
  }

  const handleStaticDelete = (entry: Record<string, string>) => {
    panel.addChange({
      operation: 'remove',
      path: '/ip/dns/static',
      entryId: entry['.id'],
      properties: {},
      description: `Delete DNS entry: ${entry.name}`,
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading DNS configuration...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'DNS Servers', value: settings?.servers || 'Not configured' },
          { label: 'Remote Requests', value: settings?.['allow-remote-requests'] === 'true' ? 'Allowed' : 'Blocked' },
          { label: 'Static Entries', value: String(staticEntries.entries.length) },
        ]}
        isLoading={isLoading}
      />

      <SimpleFormSection icon={Server} title="DNS Servers" description="Configure upstream DNS resolvers">
        <SimpleFormField
          field={{ key: 'servers', label: 'Upstream Servers', type: 'text', required: true, placeholder: '8.8.8.8,8.8.4.4', help: 'Comma-separated list of DNS server IPs used for name resolution' }}
          value={currentServers}
          onChange={setEditedServers}
        />
        <SimpleFormField
          field={{ key: 'allow-remote-requests', label: 'Allow Remote Requests', type: 'boolean', help: 'Allow devices on your network to use this router as their DNS server' }}
          value={currentRemote}
          onChange={setEditedRemote}
        />
        <SimpleFormField
          field={{ key: 'cache-size', label: 'Cache Size (KiB)', type: 'number', placeholder: '2048', help: 'DNS cache size in KiB' }}
          value={currentCacheSize}
          onChange={setEditedCacheSize}
        />
        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={stageResolverChanges}>
            Stage Changes
          </Button>
        </div>
      </SimpleFormSection>

      <SimpleFormSection icon={Globe} title="Static DNS Entries" description="Local name resolution overrides">
        {staticEntries.entries.length === 0 ? (
          <p className="text-xs text-text-muted">No static DNS entries configured</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-elevated/30">
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Name</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Address</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Type</th>
                  <th className="text-right px-3 py-2 font-medium text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staticEntries.entries.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-1.5 text-text-primary">{entry.name}</td>
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{entry.address}</td>
                    <td className="px-3 py-1.5 text-text-muted">{entry.type ?? 'A'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEditDialog(entry)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-error" onClick={() => handleStaticDelete(entry)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Button size="sm" variant="outline" onClick={openAddDialog} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Entry
        </Button>
      </SimpleFormSection>

      <SimpleApplyBar
        pendingCount={panel.pendingChanges.length}
        isApplying={panel.isApplying}
        onReviewClick={() => setPreviewOpen(true)}
      />

      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }}
        isApplying={panel.isApplying}
      />

      {/* Static entry add/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit DNS Entry' : 'Add DNS Entry'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Name <span className="text-error">*</span></Label>
              <Input
                value={staticForm.name}
                onChange={(e) => setStaticForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="myserver.local"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Address <span className="text-error">*</span></Label>
              <Input
                value={staticForm.address}
                onChange={(e) => setStaticForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="192.168.88.100"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Type</Label>
              <Select value={staticForm.type} onValueChange={(v) => setStaticForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DNS_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleStaticSave}
              disabled={!staticForm.name || !staticForm.address}
            >
              {editingId ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
