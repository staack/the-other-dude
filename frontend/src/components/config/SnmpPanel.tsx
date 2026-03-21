/**
 * SnmpPanel -- SNMP configuration panel.
 *
 * Enable/disable SNMP (/snmp).
 * Community strings management (/snmp/community).
 * Trap target configuration.
 * Contact, location, engine-id settings.
 */

import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Radio } from 'lucide-react'
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

export function SnmpPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const snmp = useConfigBrowse(tenantId, deviceId, '/snmp', { enabled: active })
  const communities = useConfigBrowse(tenantId, deviceId, '/snmp/community', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'snmp')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<Record<string, string> | null>(null)
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({})
  const [communityForm, setCommunityForm] = useState<Record<string, string>>({})

  const snmpData = snmp.entries[0] ?? {}
  const isEnabled = snmpData['enabled'] === 'true' || snmpData['enabled'] === 'yes'

  const handleToggleSnmp = useCallback(() => {
    panel.addChange({
      operation: 'set',
      path: '/snmp',
      properties: { enabled: isEnabled ? 'no' : 'yes' },
      description: `${isEnabled ? 'Disable' : 'Enable'} SNMP`,
    })
  }, [isEnabled, panel])

  const handleEditSettings = useCallback(() => {
    setSettingsForm({
      contact: snmpData['contact'] || '',
      location: snmpData['location'] || '',
      'engine-id': snmpData['engine-id'] || '',
      'trap-target': snmpData['trap-target'] || '',
      'trap-community': snmpData['trap-community'] || '',
      'trap-version': snmpData['trap-version'] || '1',
    })
    setSettingsOpen(true)
  }, [snmpData])

  const handleSaveSettings = useCallback(() => {
    const props: Record<string, string> = {}
    Object.entries(settingsForm).forEach(([key, value]) => {
      if (value !== (snmpData[key] || '')) props[key] = value
    })
    if (Object.keys(props).length === 0) { setSettingsOpen(false); return }
    panel.addChange({
      operation: 'set',
      path: '/snmp',
      properties: props,
      description: `Update SNMP settings (${Object.keys(props).join(', ')})`,
    })
    setSettingsOpen(false)
  }, [settingsForm, snmpData, panel])

  const handleAddCommunity = useCallback(() => {
    setEditEntry(null)
    setCommunityForm({
      name: '',
      addresses: '0.0.0.0/0',
      'read-access': 'yes',
      'write-access': 'no',
      security: 'none',
      'authentication-protocol': 'MD5',
      'encryption-protocol': 'DES',
    })
    setCommunityOpen(true)
  }, [])

  const handleEditCommunity = useCallback((entry: Record<string, string>) => {
    setEditEntry(entry)
    setCommunityForm({
      name: entry['name'] || '',
      addresses: entry['addresses'] || '',
      'read-access': entry['read-access'] || 'yes',
      'write-access': entry['write-access'] || 'no',
      security: entry['security'] || 'none',
      'authentication-protocol': entry['authentication-protocol'] || 'MD5',
      'encryption-protocol': entry['encryption-protocol'] || 'DES',
    })
    setCommunityOpen(true)
  }, [])

  const handleSaveCommunity = useCallback(() => {
    if (!communityForm['name']) return
    if (editEntry) {
      const props: Record<string, string> = {}
      Object.entries(communityForm).forEach(([key, value]) => {
        if (value !== editEntry[key]) props[key] = value
      })
      if (Object.keys(props).length === 0) { setCommunityOpen(false); return }
      panel.addChange({
        operation: 'set',
        path: '/snmp/community',
        entryId: editEntry['.id'],
        properties: props,
        description: `Update SNMP community "${communityForm['name']}"`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/snmp/community',
        properties: communityForm,
        description: `Add SNMP community "${communityForm['name']}"`,
      })
    }
    setCommunityOpen(false)
  }, [communityForm, editEntry, panel])

  const handleDeleteCommunity = useCallback((entry: Record<string, string>) => {
    panel.addChange({
      operation: 'remove',
      path: '/snmp/community',
      entryId: entry['.id'],
      properties: {},
      description: `Remove SNMP community "${entry['name']}"`,
    })
  }, [panel])

  if (snmp.isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading SNMP settings...</div>
  }
  if (snmp.error) {
    return <div className="flex items-center justify-center py-12 text-error text-sm">Failed to load. <button className="underline ml-1" onClick={() => snmp.refetch()}>Retry</button></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button size="sm" disabled={panel.pendingChanges.length === 0 || panel.isApplying} onClick={() => setPreviewOpen(true)}>
          Review & Apply ({panel.pendingChanges.length})
        </Button>
      </div>

      {/* SNMP Status + Settings */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-secondary">SNMP Service</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleToggleSnmp}
              className={cn(
                'text-xs px-2.5 py-1 rounded border transition-colors',
                isEnabled
                  ? 'border-success/50 bg-success/10 text-success'
                  : 'border-border bg-elevated text-text-muted',
              )}
            >
              {isEnabled ? 'Enabled' : 'Disabled'}
            </button>
            <Button size="sm" variant="outline" className="gap-1" onClick={handleEditSettings}>
              <Pencil className="h-3.5 w-3.5" /> Settings
            </Button>
          </div>
        </div>
        <div className="px-4 py-3 space-y-1.5">
          <InfoRow label="Contact" value={snmpData['contact']} />
          <InfoRow label="Location" value={snmpData['location']} />
          <InfoRow label="Engine ID" value={snmpData['engine-id']} />
          <InfoRow label="Trap Target" value={snmpData['trap-target']} />
          <InfoRow label="Trap Community" value={snmpData['trap-community']} />
          <InfoRow label="Trap Version" value={snmpData['trap-version']} />
        </div>
      </div>

      {/* Communities */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">SNMP Communities</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAddCommunity}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {communities.entries.length === 0 ? (
          <div className="p-4 text-center text-sm text-text-muted">No SNMP communities configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-text-muted">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Addresses</th>
                  <th className="text-center px-3 py-2">Read</th>
                  <th className="text-center px-3 py-2">Write</th>
                  <th className="text-left px-3 py-2">Security</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {communities.entries.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 text-text-primary font-medium">{entry['name']}</td>
                    <td className="px-3 py-1.5 text-text-secondary">{entry['addresses'] || '0.0.0.0/0'}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={entry['read-access'] === 'yes' ? 'text-success' : 'text-text-muted'}>
                        {entry['read-access'] === 'yes' ? 'Y' : 'N'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={entry['write-access'] === 'yes' ? 'text-warning' : 'text-text-muted'}>
                        {entry['write-access'] === 'yes' ? 'Y' : 'N'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-text-secondary">{entry['security'] || 'none'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleEditCommunity(entry)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-error" onClick={() => handleDeleteCommunity(entry)}>
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
      </div>

      {/* SNMP Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>SNMP Settings</DialogTitle>
            <DialogDescription>Configure SNMP service settings. Changes are staged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2 grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Contact</Label>
              <Input value={settingsForm['contact'] || ''} onChange={(e) => setSettingsForm((f) => ({ ...f, contact: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Location</Label>
              <Input value={settingsForm['location'] || ''} onChange={(e) => setSettingsForm((f) => ({ ...f, location: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Engine ID</Label>
              <Input value={settingsForm['engine-id'] || ''} onChange={(e) => setSettingsForm((f) => ({ ...f, 'engine-id': e.target.value }))} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Trap Target</Label>
              <Input value={settingsForm['trap-target'] || ''} onChange={(e) => setSettingsForm((f) => ({ ...f, 'trap-target': e.target.value }))} placeholder="192.168.1.100" className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Trap Community</Label>
              <Input value={settingsForm['trap-community'] || ''} onChange={(e) => setSettingsForm((f) => ({ ...f, 'trap-community': e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Trap Version</Label>
              <select value={settingsForm['trap-version'] || '1'} onChange={(e) => setSettingsForm((f) => ({ ...f, 'trap-version': e.target.value }))}
                className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary">
                <option value="1">v1</option>
                <option value="2">v2c</option>
                <option value="3">v3</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings}>Stage Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Community dialog */}
      <Dialog open={communityOpen} onOpenChange={setCommunityOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editEntry ? 'Edit Community' : 'Add Community'}</DialogTitle>
            <DialogDescription>Configure SNMP community string. Changes are staged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Name</Label>
                <Input value={communityForm['name'] || ''} onChange={(e) => setCommunityForm((f) => ({ ...f, name: e.target.value }))} placeholder="public" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Addresses</Label>
                <Input value={communityForm['addresses'] || ''} onChange={(e) => setCommunityForm((f) => ({ ...f, addresses: e.target.value }))} placeholder="0.0.0.0/0" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Read Access</Label>
                <select value={communityForm['read-access'] || 'yes'} onChange={(e) => setCommunityForm((f) => ({ ...f, 'read-access': e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary">
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Write Access</Label>
                <select value={communityForm['write-access'] || 'no'} onChange={(e) => setCommunityForm((f) => ({ ...f, 'write-access': e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary">
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Security</Label>
                <select value={communityForm['security'] || 'none'} onChange={(e) => setCommunityForm((f) => ({ ...f, security: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary">
                  <option value="none">None</option>
                  <option value="authorized">Authorized</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommunityOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCommunity} disabled={!communityForm['name']}>Stage Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start gap-4 py-1 border-b border-border/20 last:border-0">
      <span className="text-xs text-text-muted w-28 flex-shrink-0">{label}</span>
      <span className="text-sm text-text-primary font-mono">{value || '—'}</span>
    </div>
  )
}
