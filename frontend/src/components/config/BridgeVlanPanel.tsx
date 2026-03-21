/**
 * BridgeVlanPanel -- Bridge VLAN table management.
 *
 * View/add/edit/delete VLAN entries (/interface/bridge/vlan).
 * Tagged/untagged port assignment per VLAN.
 * Bridge VLAN filtering enable/disable.
 * Visual port-to-VLAN matrix view.
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
import { SafetyToggle } from './SafetyToggle'
import { ChangePreviewModal } from './ChangePreviewModal'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

export function BridgeVlanPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const vlans = useConfigBrowse(tenantId, deviceId, '/interface/bridge/vlan', { enabled: active })
  const bridges = useConfigBrowse(tenantId, deviceId, '/interface/bridge', { enabled: active })
  const ports = useConfigBrowse(tenantId, deviceId, '/interface/bridge/port', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'bridge-vlans')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<Record<string, string> | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})

  const bridgeNames = useMemo(
    () => bridges.entries.map((b) => b['name']).filter(Boolean),
    [bridges.entries],
  )

  // Get all port interfaces on bridges for the matrix
  const portInterfaces = useMemo(
    () => ports.entries.map((p) => p['interface']).filter(Boolean),
    [ports.entries],
  )

  const handleAdd = useCallback(() => {
    setEditEntry(null)
    setFormData({
      bridge: bridgeNames[0] || 'bridge1',
      'vlan-ids': '',
      tagged: '',
      untagged: '',
    })
    setEditOpen(true)
  }, [bridgeNames])

  const handleEdit = useCallback((entry: Record<string, string>) => {
    setEditEntry(entry)
    setFormData({
      bridge: entry['bridge'] || '',
      'vlan-ids': entry['vlan-ids'] || '',
      tagged: entry['tagged'] || '',
      untagged: entry['untagged'] || '',
    })
    setEditOpen(true)
  }, [])

  const handleSave = useCallback(() => {
    if (!formData['vlan-ids'] || !formData['bridge']) return
    if (editEntry) {
      const props: Record<string, string> = {}
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== editEntry[key]) props[key] = value
      })
      if (Object.keys(props).length === 0) { setEditOpen(false); return }
      panel.addChange({
        operation: 'set',
        path: '/interface/bridge/vlan',
        entryId: editEntry['.id'],
        properties: props,
        description: `Update VLAN ${formData['vlan-ids']} on ${formData['bridge']}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/interface/bridge/vlan',
        properties: formData,
        description: `Add VLAN ${formData['vlan-ids']} to ${formData['bridge']}`,
      })
    }
    setEditOpen(false)
  }, [formData, editEntry, panel])

  const handleDelete = useCallback((entry: Record<string, string>) => {
    panel.addChange({
      operation: 'remove',
      path: '/interface/bridge/vlan',
      entryId: entry['.id'],
      properties: {},
      description: `Remove VLAN ${entry['vlan-ids']} from ${entry['bridge']}`,
    })
  }, [panel])

  const handleToggleVlanFiltering = useCallback((bridge: Record<string, string>) => {
    const current = bridge['vlan-filtering'] === 'true' || bridge['vlan-filtering'] === 'yes'
    panel.addChange({
      operation: 'set',
      path: '/interface/bridge',
      entryId: bridge['.id'],
      properties: { 'vlan-filtering': current ? 'no' : 'yes' },
      description: `${current ? 'Disable' : 'Enable'} VLAN filtering on ${bridge['name']}`,
    })
  }, [panel])

  if (vlans.isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading bridge VLANs...</div>
  }
  if (vlans.error) {
    return <div className="flex items-center justify-center py-12 text-error text-sm">Failed to load. <button className="underline ml-1" onClick={() => vlans.refetch()}>Retry</button></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" /> Add VLAN
          </Button>
          <Button size="sm" disabled={panel.pendingChanges.length === 0 || panel.isApplying} onClick={() => setPreviewOpen(true)}>
            Review & Apply ({panel.pendingChanges.length})
          </Button>
        </div>
      </div>

      {/* VLAN Filtering status per bridge */}
      {bridges.entries.length > 0 && (
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="flex items-center gap-2 mb-2">
            <Network className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-secondary">Bridge VLAN Filtering</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {bridges.entries.map((bridge) => {
              const enabled = bridge['vlan-filtering'] === 'true' || bridge['vlan-filtering'] === 'yes'
              return (
                <button
                  key={bridge['.id']}
                  onClick={() => handleToggleVlanFiltering(bridge)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors',
                    enabled
                      ? 'border-success/50 bg-success/10 text-success'
                      : 'border-border bg-elevated text-text-muted hover:text-text-secondary',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', enabled ? 'bg-success' : 'bg-text-muted')} />
                  {bridge['name']}: {enabled ? 'Enabled' : 'Disabled'}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* VLAN Table */}
      {vlans.entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-text-muted">
          No bridge VLAN entries configured.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-text-muted">
                  <th className="text-left px-3 py-2">VLAN IDs</th>
                  <th className="text-left px-3 py-2">Bridge</th>
                  <th className="text-left px-3 py-2">Tagged</th>
                  <th className="text-left px-3 py-2">Untagged</th>
                  <th className="text-left px-3 py-2">Current Tagged</th>
                  <th className="text-left px-3 py-2">Current Untagged</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {vlans.entries.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5">
                      <span className="text-accent font-medium">{entry['vlan-ids']}</span>
                    </td>
                    <td className="px-3 py-1.5 text-text-secondary">{entry['bridge']}</td>
                    <td className="px-3 py-1.5 text-text-primary">
                      {entry['tagged'] ? (
                        <div className="flex flex-wrap gap-1">
                          {entry['tagged'].split(',').map((p) => (
                            <span key={p} className="bg-info/10 text-info px-1 py-0.5 rounded text-[10px]">{p.trim()}</span>
                          ))}
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-text-primary">
                      {entry['untagged'] ? (
                        <div className="flex flex-wrap gap-1">
                          {entry['untagged'].split(',').map((p) => (
                            <span key={p} className="bg-warning/10 text-warning px-1 py-0.5 rounded text-[10px]">{p.trim()}</span>
                          ))}
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-text-muted text-[10px]">{entry['current-tagged'] || '-'}</td>
                    <td className="px-3 py-1.5 text-text-muted text-[10px]">{entry['current-untagged'] || '-'}</td>
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
            <DialogTitle>{editEntry ? 'Edit Bridge VLAN' : 'Add Bridge VLAN'}</DialogTitle>
            <DialogDescription>Configure VLAN entry. Comma-separate multiple ports. Changes are staged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Bridge</Label>
                <select
                  value={formData['bridge'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, bridge: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary font-mono"
                >
                  {bridgeNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">VLAN IDs</Label>
                <Input
                  value={formData['vlan-ids'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, 'vlan-ids': e.target.value }))}
                  placeholder="10,20 or 10-20"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Tagged Ports</Label>
              <Input
                value={formData['tagged'] || ''}
                onChange={(e) => setFormData((f) => ({ ...f, tagged: e.target.value }))}
                placeholder="bridge1,ether1,ether2"
                className="h-8 text-sm font-mono"
              />
              {portInterfaces.length > 0 && (
                <p className="text-[10px] text-text-muted">Available: {portInterfaces.join(', ')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Untagged Ports</Label>
              <Input
                value={formData['untagged'] || ''}
                onChange={(e) => setFormData((f) => ({ ...f, untagged: e.target.value }))}
                placeholder="ether3,ether4"
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formData['vlan-ids'] || !formData['bridge']}>Stage Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}
