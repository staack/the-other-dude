/**
 * SystemPanel -- System identity, clock/NTP, and resource display.
 *
 * Sub-tabs:
 * 1. Identity -- view/edit system identity
 * 2. Clock -- timezone and NTP client config
 * 3. Resources -- read-only CPU, memory, disk, uptime, board, version
 */

import { useState, useCallback } from 'react'
import { Pencil, Clock, Cpu, Info } from 'lucide-react'
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

// ---------------------------------------------------------------------------
// Sub-tab types
// ---------------------------------------------------------------------------

type SubTab = 'identity' | 'clock' | 'resources'

const SUB_TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: 'identity', label: 'Identity', icon: <Info className="h-3.5 w-3.5" /> },
  { key: 'clock', label: 'Clock & NTP', icon: <Clock className="h-3.5 w-3.5" /> },
  { key: 'resources', label: 'Resources', icon: <Cpu className="h-3.5 w-3.5" /> },
]

// ---------------------------------------------------------------------------
// SystemPanel
// ---------------------------------------------------------------------------

export function SystemPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('identity')

  const identity = useConfigBrowse(tenantId, deviceId, '/system/identity', { enabled: active })
  const clock = useConfigBrowse(tenantId, deviceId, '/system/clock', { enabled: active })
  const ntp = useConfigBrowse(tenantId, deviceId, '/system/ntp/client', { enabled: active })
  const resource = useConfigBrowse(tenantId, deviceId, '/system/resource', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'system')
  const [previewOpen, setPreviewOpen] = useState(false)

  const isLoading = identity.isLoading || clock.isLoading || resource.isLoading
  const hasError = identity.error || clock.error || resource.error

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading system configuration...
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load system configuration.{' '}
        <button className="underline ml-1" onClick={() => { identity.refetch(); clock.refetch(); resource.refetch() }}>
          Retry
        </button>
      </div>
    )
  }

  // System identity is a single record (not a list)
  const identityData = identity.entries[0] ?? {}
  const clockData = clock.entries[0] ?? {}
  const ntpData = ntp.entries[0] ?? {}
  const resourceData = resource.entries[0] ?? {}

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
                ? 'bg-panel text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-panel/50',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'identity' && (
        <IdentityTab data={identityData} panel={panel} />
      )}
      {activeTab === 'clock' && (
        <ClockTab clockData={clockData} ntpData={ntpData} panel={panel} />
      )}
      {activeTab === 'resources' && (
        <ResourcesTab data={resourceData} />
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
// Identity Tab
// ---------------------------------------------------------------------------

function IdentityTab({
  data,
  panel,
}: {
  data: Record<string, string>
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')

  const handleEdit = useCallback(() => {
    setName(data.name || '')
    setDialogOpen(true)
  }, [data.name])

  const handleSave = useCallback(() => {
    if (!name.trim()) return
    panel.addChange({
      operation: 'set',
      path: '/system/identity',
      properties: { name: name.trim() },
      description: `Set system identity to "${name.trim()}"`,
    })
    setDialogOpen(false)
  }, [name, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">System Identity</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-text-muted w-24">Identity</span>
            <span className="text-sm text-text-primary font-medium">{data.name || '—'}</span>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit System Identity</DialogTitle>
            <DialogDescription>
              Change the device's system name. This is staged until you apply.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 mt-2">
            <Label htmlFor="sys-name" className="text-xs text-text-secondary">
              System Name
            </Label>
            <Input
              id="sys-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MikroTik"
              className="h-8 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim()}>Stage Change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Clock Tab
// ---------------------------------------------------------------------------

function ClockTab({
  clockData,
  ntpData,
  panel,
}: {
  clockData: Record<string, string>
  ntpData: Record<string, string>
  panel: PanelHook
}) {
  const [editClock, setEditClock] = useState(false)
  const [timezone, setTimezone] = useState('')
  const [editNtp, setEditNtp] = useState(false)
  const [ntpServer, setNtpServer] = useState('')
  const [ntpEnabled, setNtpEnabled] = useState('')

  const handleEditClock = useCallback(() => {
    setTimezone(clockData['time-zone-name'] || '')
    setEditClock(true)
  }, [clockData])

  const handleSaveClock = useCallback(() => {
    if (!timezone.trim()) return
    panel.addChange({
      operation: 'set',
      path: '/system/clock',
      properties: { 'time-zone-name': timezone.trim() },
      description: `Set timezone to "${timezone.trim()}"`,
    })
    setEditClock(false)
  }, [timezone, panel])

  const handleEditNtp = useCallback(() => {
    setNtpServer(ntpData['primary-ntp'] || ntpData.server || '')
    setNtpEnabled(ntpData.enabled || 'yes')
    setEditNtp(true)
  }, [ntpData])

  const handleSaveNtp = useCallback(() => {
    const props: Record<string, string> = { enabled: ntpEnabled }
    if (ntpServer.trim()) {
      props['primary-ntp'] = ntpServer.trim()
    }
    panel.addChange({
      operation: 'set',
      path: '/system/ntp/client',
      properties: props,
      description: `Configure NTP client (${ntpEnabled === 'yes' ? 'enabled' : 'disabled'}${ntpServer ? ', server: ' + ntpServer : ''})`,
    })
    setEditNtp(false)
  }, [ntpServer, ntpEnabled, panel])

  return (
    <div className="space-y-4">
      {/* Clock info */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">Clock Settings</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleEditClock}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
        <div className="px-4 py-3 space-y-2">
          <InfoRow label="Date" value={clockData.date} />
          <InfoRow label="Time" value={clockData.time} />
          <InfoRow label="Timezone" value={clockData['time-zone-name']} />
          <InfoRow label="GMT Offset" value={clockData['gmt-offset']} />
        </div>
      </div>

      {/* NTP info */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">NTP Client</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleEditNtp}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
        <div className="px-4 py-3 space-y-2">
          <InfoRow label="Enabled" value={ntpData.enabled} />
          <InfoRow label="Server" value={ntpData['primary-ntp'] || ntpData.server} />
          <InfoRow label="Status" value={ntpData.status} />
        </div>
      </div>

      {/* Clock edit dialog */}
      <Dialog open={editClock} onOpenChange={setEditClock}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Clock Settings</DialogTitle>
            <DialogDescription>Change the timezone. Staged until you apply.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 mt-2">
            <Label className="text-xs text-text-secondary">Timezone</Label>
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
              className="h-8 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClock(false)}>Cancel</Button>
            <Button onClick={handleSaveClock} disabled={!timezone.trim()}>Stage Change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NTP edit dialog */}
      <Dialog open={editNtp} onOpenChange={setEditNtp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit NTP Client</DialogTitle>
            <DialogDescription>Configure NTP server. Staged until you apply.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Enabled</Label>
              <select
                value={ntpEnabled}
                onChange={(e) => setNtpEnabled(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Primary NTP Server</Label>
              <Input
                value={ntpServer}
                onChange={(e) => setNtpServer(e.target.value)}
                placeholder="pool.ntp.org"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNtp(false)}>Cancel</Button>
            <Button onClick={handleSaveNtp}>Stage Change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resources Tab (read-only)
// ---------------------------------------------------------------------------

function ResourcesTab({ data }: { data: Record<string, string> }) {
  const memTotal = parseInt(data['total-memory'] || '0', 10)
  const memFree = parseInt(data['free-memory'] || '0', 10)
  const memUsed = memTotal - memFree
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0

  const diskTotal = parseInt(data['total-hdd-space'] || '0', 10)
  const diskFree = parseInt(data['free-hdd-space'] || '0', 10)
  const diskUsed = diskTotal - diskFree
  const diskPct = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">System Resources</span>
        </div>
        <div className="px-4 py-3 space-y-2">
          <InfoRow label="Board" value={data['board-name']} />
          <InfoRow label="Architecture" value={data.architecture} />
          <InfoRow label="CPU" value={data.cpu} />
          <InfoRow label="CPU Count" value={data['cpu-count']} />
          <InfoRow label="CPU Load" value={data['cpu-load'] ? `${data['cpu-load']}%` : undefined} />
          <InfoRow label="Version" value={data.version} />
          <InfoRow label="Uptime" value={data.uptime} />

          {/* Memory bar */}
          <div className="flex items-start gap-4 py-2 border-b border-border/50">
            <span className="text-xs text-text-muted w-24 flex-shrink-0 pt-0.5">Memory</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <div className="flex-1 h-2 rounded-full bg-elevated overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      memPct > 90 ? 'bg-error' : memPct > 70 ? 'bg-warning' : 'bg-accent',
                    )}
                    style={{ width: `${memPct}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary w-14 text-right">{memPct}%</span>
              </div>
              <span className="text-xs text-text-muted">
                {formatBytes(memUsed)} / {formatBytes(memTotal)}
              </span>
            </div>
          </div>

          {/* Disk bar */}
          <div className="flex items-start gap-4 py-2">
            <span className="text-xs text-text-muted w-24 flex-shrink-0 pt-0.5">Disk</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <div className="flex-1 h-2 rounded-full bg-elevated overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      diskPct > 90 ? 'bg-error' : diskPct > 70 ? 'bg-warning' : 'bg-accent',
                    )}
                    style={{ width: `${diskPct}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary w-14 text-right">{diskPct}%</span>
              </div>
              <span className="text-xs text-text-muted">
                {formatBytes(diskUsed)} / {formatBytes(diskTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start gap-4 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-text-muted w-24 flex-shrink-0">{label}</span>
      <span className="text-sm text-text-primary">{value || '—'}</span>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i] || 'TB'}`
}
