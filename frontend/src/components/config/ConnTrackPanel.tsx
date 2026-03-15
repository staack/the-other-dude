/**
 * ConnTrackPanel -- Connection tracking settings panel.
 *
 * View/edit connection tracking (/ip/firewall/connection/tracking),
 * timeout settings, max entries, active connection count.
 * Safe apply mode by default.
 */

import { useState, useCallback } from 'react'
import { Pencil, Activity } from 'lucide-react'
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
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Timeout fields we expose for editing
const TIMEOUT_FIELDS = [
  { key: 'tcp-established-timeout', label: 'TCP Established' },
  { key: 'tcp-syn-sent-timeout', label: 'TCP SYN Sent' },
  { key: 'tcp-syn-received-timeout', label: 'TCP SYN Received' },
  { key: 'tcp-close-wait-timeout', label: 'TCP Close Wait' },
  { key: 'tcp-fin-wait-timeout', label: 'TCP FIN Wait' },
  { key: 'tcp-time-wait-timeout', label: 'TCP Time Wait' },
  { key: 'tcp-close-timeout', label: 'TCP Close' },
  { key: 'udp-timeout', label: 'UDP' },
  { key: 'udp-stream-timeout', label: 'UDP Stream' },
  { key: 'icmp-timeout', label: 'ICMP' },
  { key: 'generic-timeout', label: 'Generic' },
]

// ---------------------------------------------------------------------------
// ConnTrackPanel
// ---------------------------------------------------------------------------

export function ConnTrackPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const tracking = useConfigBrowse(tenantId, deviceId, '/ip/firewall/connection/tracking', { enabled: active })
  const connections = useConfigBrowse(tenantId, deviceId, '/ip/firewall/connection', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'conntrack')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [formData, setFormData] = useState<Record<string, string>>({})

  const trackingData = tracking.entries[0] ?? {}
  const activeCount = connections.entries.length

  const handleEdit = useCallback(() => {
    const data: Record<string, string> = {}
    TIMEOUT_FIELDS.forEach((f) => { data[f.key] = trackingData[f.key] || '' })
    data['max-entries'] = trackingData['max-entries'] || ''
    data['enabled'] = trackingData['enabled'] || 'auto'
    setFormData(data)
    setEditOpen(true)
  }, [trackingData])

  const handleSave = useCallback(() => {
    const props: Record<string, string> = {}
    // Only include changed fields
    Object.entries(formData).forEach(([key, value]) => {
      if (value && value !== trackingData[key]) {
        props[key] = value
      }
    })
    if (Object.keys(props).length === 0) { setEditOpen(false); return }

    panel.addChange({
      operation: 'set',
      path: '/ip/firewall/connection/tracking',
      properties: props,
      description: `Update connection tracking (${Object.keys(props).join(', ')})`,
    })
    setEditOpen(false)
  }, [formData, trackingData, panel])

  if (tracking.isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading connection tracking...</div>
  }
  if (tracking.error) {
    return <div className="flex items-center justify-center py-12 text-error text-sm">Failed to load. <button className="underline ml-1" onClick={() => tracking.refetch()}>Retry</button></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button size="sm" disabled={panel.pendingChanges.length === 0 || panel.isApplying} onClick={() => setPreviewOpen(true)}>
          Review & Apply ({panel.pendingChanges.length})
        </Button>
      </div>

      {/* Active connections count */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-accent" />
          <div>
            <span className="text-2xl font-bold text-text-primary">{activeCount}</span>
            <span className="text-sm text-text-secondary ml-2">active connections</span>
          </div>
          {trackingData['max-entries'] && (
            <span className="text-xs text-text-muted ml-auto">
              max: {trackingData['max-entries']}
            </span>
          )}
        </div>
      </div>

      {/* Tracking settings */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">Connection Tracking Settings</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
        <div className="px-4 py-3 space-y-1.5">
          <InfoRow label="Enabled" value={trackingData['enabled']} />
          <InfoRow label="Max Entries" value={trackingData['max-entries']} />
          <div className="border-t border-border/50 pt-2 mt-2">
            <span className="text-xs font-medium text-text-secondary">Timeouts</span>
          </div>
          {TIMEOUT_FIELDS.map((f) => (
            <InfoRow key={f.key} label={f.label} value={trackingData[f.key]} />
          ))}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Connection Tracking</DialogTitle>
            <DialogDescription>Modify timeout values and max entries. Changes are staged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Enabled</Label>
                <select
                  value={formData['enabled'] || 'auto'}
                  onChange={(e) => setFormData((f) => ({ ...f, enabled: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  <option value="auto">Auto</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Max Entries</Label>
                <Input
                  type="number"
                  value={formData['max-entries'] || ''}
                  onChange={(e) => setFormData((f) => ({ ...f, 'max-entries': e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <span className="text-xs font-medium text-text-secondary">Timeouts</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {TIMEOUT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs text-text-secondary">{f.label}</Label>
                  <Input
                    value={formData[f.key] || ''}
                    onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder="00:05:00"
                    className="h-8 text-sm font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Stage Changes</Button>
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
      <span className="text-xs text-text-muted w-32 flex-shrink-0">{label}</span>
      <span className="text-sm text-text-primary font-mono">{value || '—'}</span>
    </div>
  )
}
