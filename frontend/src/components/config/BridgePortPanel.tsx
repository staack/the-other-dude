/**
 * BridgePortPanel -- Bridge port management.
 *
 * View/add/edit/delete bridge ports (/interface/bridge/port).
 * Columns: interface, bridge, PVID, frame-types, ingress-filtering.
 * STP settings: path-cost, priority, edge port.
 * Hardware offload indicator.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Cpu } from 'lucide-react'
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

const FRAME_TYPES = ['admit-all', 'admit-only-untagged-and-priority-tagged', 'admit-only-vlan-tagged']

export function BridgePortPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const ports = useConfigBrowse(tenantId, deviceId, '/interface/bridge/port', { enabled: active })
  const bridges = useConfigBrowse(tenantId, deviceId, '/interface/bridge', { enabled: active })
  const interfaces = useConfigBrowse(tenantId, deviceId, '/interface', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'bridge-ports')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<Record<string, string> | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})

  const bridgeNames = useMemo(
    () => bridges.entries.map((b) => b['name']).filter(Boolean),
    [bridges.entries],
  )
  const ifaceNames = useMemo(
    () => interfaces.entries.map((i) => i['name']).filter(Boolean),
    [interfaces.entries],
  )

  const handleAdd = useCallback(() => {
    setEditEntry(null)
    setFormData({
      interface: '',
      bridge: bridgeNames[0] || 'bridge1',
      pvid: '1',
      'frame-types': 'admit-all',
      'ingress-filtering': 'no',
      'path-cost': '10',
      priority: '0x80',
      edge: 'auto',
      'hw': 'yes',
    })
    setEditOpen(true)
  }, [bridgeNames])

  const handleEdit = useCallback((entry: Record<string, string>) => {
    setEditEntry(entry)
    setFormData({
      interface: entry['interface'] || '',
      bridge: entry['bridge'] || '',
      pvid: entry['pvid'] || '1',
      'frame-types': entry['frame-types'] || 'admit-all',
      'ingress-filtering': entry['ingress-filtering'] || 'no',
      'path-cost': entry['path-cost'] || '10',
      priority: entry['priority'] || '0x80',
      edge: entry['edge'] || 'auto',
      'hw': entry['hw'] || 'yes',
    })
    setEditOpen(true)
  }, [])

  const handleSave = useCallback(() => {
    if (!formData['interface'] || !formData['bridge']) return
    if (editEntry) {
      const props: Record<string, string> = {}
      Object.entries(formData).forEach(([key, value]) => {
        if (value && value !== editEntry[key]) props[key] = value
      })
      if (Object.keys(props).length === 0) { setEditOpen(false); return }
      panel.addChange({
        operation: 'set',
        path: '/interface/bridge/port',
        entryId: editEntry['.id'],
        properties: props,
        description: `Update bridge port ${formData['interface']} on ${formData['bridge']}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/interface/bridge/port',
        properties: formData,
        description: `Add ${formData['interface']} to bridge ${formData['bridge']}`,
      })
    }
    setEditOpen(false)
  }, [formData, editEntry, panel])

  const handleDelete = useCallback((entry: Record<string, string>) => {
    panel.addChange({
      operation: 'remove',
      path: '/interface/bridge/port',
      entryId: entry['.id'],
      properties: {},
      description: `Remove ${entry['interface']} from bridge ${entry['bridge']}`,
    })
  }, [panel])

  if (ports.isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading bridge ports...</div>
  }
  if (ports.error) {
    return <div className="flex items-center justify-center py-12 text-error text-sm">Failed to load. <button className="underline ml-1" onClick={() => ports.refetch()}>Retry</button></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" /> Add Port
          </Button>
          <Button size="sm" disabled={panel.pendingChanges.length === 0 || panel.isApplying} onClick={() => setPreviewOpen(true)}>
            Review & Apply ({panel.pendingChanges.length})
          </Button>
        </div>
      </div>

      {ports.entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          No bridge ports configured.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-text-muted">
                  <th className="text-left px-3 py-2">Interface</th>
                  <th className="text-left px-3 py-2">Bridge</th>
                  <th className="text-left px-3 py-2">PVID</th>
                  <th className="text-left px-3 py-2">Frame Types</th>
                  <th className="text-left px-3 py-2">Ingress Filter</th>
                  <th className="text-left px-3 py-2">STP</th>
                  <th className="text-center px-3 py-2">HW</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {ports.entries.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 text-text-primary font-medium">{entry['interface']}</td>
                    <td className="px-3 py-1.5 text-text-secondary">{entry['bridge']}</td>
                    <td className="px-3 py-1.5 text-text-primary">{entry['pvid'] || '1'}</td>
                    <td className="px-3 py-1.5 text-text-secondary text-[10px]">{entry['frame-types'] || 'admit-all'}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded',
                        entry['ingress-filtering'] === 'yes'
                          ? 'bg-success/10 text-success'
                          : 'bg-warning/10 text-warning',
                      )}>
                        {entry['ingress-filtering'] || 'no'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-text-muted text-[10px]">
                      cost={entry['path-cost'] || '10'} edge={entry['edge'] || 'auto'}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {entry['hw'] === 'yes' && <Cpu className="h-3.5 w-3.5 text-success inline-block" title="Hardware offload" />}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleEdit(entry)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-error" onClick={() => handleDelete(entry)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit/Add dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editEntry ? 'Edit Bridge Port' : 'Add Bridge Port'}</DialogTitle>
            <DialogDescription>Configure bridge port settings. Changes are staged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Interface</Label>
                <select
                  value={formData['interface'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, interface: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary font-mono"
                >
                  <option value="">Select...</option>
                  {ifaceNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Bridge</Label>
                <select
                  value={formData['bridge'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, bridge: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary font-mono"
                >
                  {bridgeNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">PVID</Label>
                <Input
                  type="number"
                  value={formData['pvid'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, pvid: e.target.value }))}
                  min={1} max={4094}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Frame Types</Label>
                <select
                  value={formData['frame-types'] || 'admit-all'}
                  onChange={(e) => setFormData((f) => ({ ...f, 'frame-types': e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  {FRAME_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Ingress Filtering</Label>
                <select
                  value={formData['ingress-filtering'] || 'no'}
                  onChange={(e) => setFormData((f) => ({ ...f, 'ingress-filtering': e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">HW Offload</Label>
                <select
                  value={formData['hw'] || 'yes'}
                  onChange={(e) => setFormData((f) => ({ ...f, hw: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <span className="text-xs font-medium text-text-secondary">STP Settings</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Path Cost</Label>
                <Input
                  type="number"
                  value={formData['path-cost'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, 'path-cost': e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Priority</Label>
                <Input
                  value={formData['priority'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, priority: e.target.value }))}
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Edge</Label>
                <select
                  value={formData['edge'] || 'auto'}
                  onChange={(e) => setFormData((f) => ({ ...f, edge: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  <option value="auto">Auto</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="no-discover">No Discover</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formData['interface'] || !formData['bridge']}>Stage Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}
