/**
 * PortForwardingPanel -- Simple mode NAT port forwarding configuration.
 *
 * Shows existing DST-NAT rules in a friendly table and provides add/edit/delete
 * dialogs with user-friendly field names (External Port, Internal IP, etc.).
 * Auto-sets chain=dstnat and action=dst-nat so users don't need to know RouterOS internals.
 */

import { useState } from 'react'
import { ArrowLeftRight, Plus, Pencil, Trash2, Power, PowerOff } from 'lucide-react'
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
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

interface PortForwardForm {
  comment: string
  protocol: string
  'dst-port': string
  'to-addresses': string
  'to-ports': string
  disabled: string
}

const EMPTY_FORM: PortForwardForm = {
  comment: '',
  protocol: 'tcp',
  'dst-port': '',
  'to-addresses': '',
  'to-ports': '',
  disabled: 'false',
}

const PROTOCOL_OPTIONS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: '6 (tcp), 17 (udp)', label: 'TCP + UDP' },
]

export function PortForwardingPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const natRules = useConfigBrowse(tenantId, deviceId, '/ip/firewall/nat', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-port-forwarding')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PortForwardForm>(EMPTY_FORM)

  // Filter to dstnat (port forward) rules only
  const dstnatRules = natRules.entries.filter((e) => e.chain === 'dstnat')
  const hasMasquerade = natRules.entries.some(
    (e) => e.chain === 'srcnat' && e.action === 'masquerade',
  )

  const isLoading = natRules.isLoading

  const openAddDialog = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEditDialog = (entry: Record<string, string>) => {
    setEditingId(entry['.id'])
    setForm({
      comment: entry.comment ?? '',
      protocol: entry.protocol ?? 'tcp',
      'dst-port': entry['dst-port'] ?? '',
      'to-addresses': entry['to-addresses'] ?? '',
      'to-ports': entry['to-ports'] ?? '',
      disabled: entry.disabled ?? 'false',
    })
    setDialogOpen(true)
  }

  const handleSave = () => {
    const props: Record<string, string> = {
      chain: 'dstnat',
      action: 'dst-nat',
      protocol: form.protocol,
      'dst-port': form['dst-port'],
      'to-addresses': form['to-addresses'],
      'to-ports': form['to-ports'] || form['dst-port'], // default to same port
    }
    if (form.comment) props.comment = form.comment
    if (form.disabled === 'true') props.disabled = 'true'

    if (editingId) {
      panel.addChange({
        operation: 'set',
        path: '/ip/firewall/nat',
        entryId: editingId,
        properties: props,
        description: `Update port forward: ${form.comment || form['dst-port']}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/firewall/nat',
        properties: props,
        description: `Add port forward: ${form.comment || `port ${form['dst-port']}`} -> ${form['to-addresses']}:${form['to-ports'] || form['dst-port']}`,
      })
    }

    setDialogOpen(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const handleDelete = (entry: Record<string, string>) => {
    panel.addChange({
      operation: 'remove',
      path: '/ip/firewall/nat',
      entryId: entry['.id'],
      properties: {},
      description: `Delete port forward: ${entry.comment || entry['dst-port']}`,
    })
  }

  const handleToggle = (entry: Record<string, string>) => {
    const newDisabled = entry.disabled === 'true' ? 'false' : 'true'
    panel.addChange({
      operation: 'set',
      path: '/ip/firewall/nat',
      entryId: entry['.id'],
      properties: { disabled: newDisabled },
      description: `${newDisabled === 'true' ? 'Disable' : 'Enable'} port forward: ${entry.comment || entry['dst-port']}`,
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading port forwarding rules...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'Port Forwards', value: String(dstnatRules.length) },
          { label: 'NAT Masquerade', value: hasMasquerade ? 'Active' : 'Not configured' },
        ]}
        isLoading={isLoading}
      />

      <SimpleFormSection
        icon={ArrowLeftRight}
        title="Port Forwarding Rules"
        description="Forward external traffic to internal network devices"
      >
        {dstnatRules.length === 0 ? (
          <p className="text-xs text-text-muted">
            No port forwarding rules configured. Add a rule to allow external access to internal services.
          </p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-elevated/30">
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Name</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Ext Port</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Protocol</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Internal IP</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Int Port</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dstnatRules.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-1.5 text-text-primary">
                      {entry.comment || <span className="text-text-muted italic">Unnamed</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{entry['dst-port'] ?? '\u2014'}</td>
                    <td className="px-3 py-1.5 text-text-secondary uppercase">{entry.protocol ?? 'tcp'}</td>
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{entry['to-addresses'] ?? '\u2014'}</td>
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{entry['to-ports'] ?? entry['dst-port'] ?? '\u2014'}</td>
                    <td className="px-3 py-1.5">
                      {entry.disabled === 'true' ? (
                        <span className="inline-flex items-center gap-1 text-text-muted">
                          <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
                          Disabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => handleToggle(entry)}
                          title={entry.disabled === 'true' ? 'Enable' : 'Disable'}
                        >
                          {entry.disabled === 'true' ? (
                            <Power className="h-3 w-3" />
                          ) : (
                            <PowerOff className="h-3 w-3" />
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEditDialog(entry)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-error" onClick={() => handleDelete(entry)}>
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
          Add Port Forward
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

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Port Forward' : 'Add Port Forward'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Name / Description</Label>
              <Input
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="e.g., Web Server"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Protocol <span className="text-error">*</span></Label>
              <Select value={form.protocol} onValueChange={(v) => setForm((f) => ({ ...f, protocol: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">External Port <span className="text-error">*</span></Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form['dst-port']}
                onChange={(e) => setForm((f) => ({ ...f, 'dst-port': e.target.value }))}
                placeholder="80"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Internal IP Address <span className="text-error">*</span></Label>
              <Input
                value={form['to-addresses']}
                onChange={(e) => setForm((f) => ({ ...f, 'to-addresses': e.target.value }))}
                placeholder="192.168.88.100"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Internal Port <span className="text-error">*</span></Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form['to-ports']}
                onChange={(e) => setForm((f) => ({ ...f, 'to-ports': e.target.value }))}
                placeholder="Same as external port"
                className="h-8 text-sm"
              />
              <p className="text-xs text-text-muted">Leave blank to use the same port as external</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!form['dst-port'] || !form['to-addresses']}
            >
              {editingId ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
