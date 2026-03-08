/**
 * SystemSimplePanel -- Simple mode system configuration.
 *
 * Covers device identity (hostname), NTP/timezone settings, read-only system
 * resource information, and a maintenance section with a reboot button.
 */

import { useState, useEffect } from 'react'
import { Settings, Clock, Info, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { SimpleFormField } from '../SimpleFormField'
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import { configEditorApi } from '@/lib/configEditorApi'
import { toast } from 'sonner'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

function formatBytes(bytes: string | undefined): string {
  if (!bytes) return '\u2014'
  const num = parseInt(bytes, 10)
  if (isNaN(num)) return bytes
  const mb = (num / 1024 / 1024).toFixed(1)
  return `${mb} MB`
}

export function SystemSimplePanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const identity = useConfigBrowse(tenantId, deviceId, '/system/identity', { enabled: active })
  const clock = useConfigBrowse(tenantId, deviceId, '/system/clock', { enabled: active })
  const ntpClient = useConfigBrowse(tenantId, deviceId, '/system/ntp/client', { enabled: active })
  const resource = useConfigBrowse(tenantId, deviceId, '/system/resource', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-system')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false)
  const [rebooting, setRebooting] = useState(false)

  const identityEntry = identity.entries[0]
  const clockEntry = clock.entries[0]
  const ntpEntry = ntpClient.entries[0]
  const resourceEntry = resource.entries[0]

  // Identity form
  const [hostname, setHostname] = useState('')

  // Clock/NTP form
  const [timezone, setTimezone] = useState('')
  const [ntpEnabled, setNtpEnabled] = useState('true')
  const [ntpServers, setNtpServers] = useState('')

  // Sync from browse data
  useEffect(() => {
    if (identityEntry) setHostname(identityEntry.name ?? '')
  }, [identityEntry])

  useEffect(() => {
    if (clockEntry) setTimezone(clockEntry['time-zone-name'] ?? '')
  }, [clockEntry])

  useEffect(() => {
    if (ntpEntry) {
      setNtpEnabled(ntpEntry.enabled ?? 'true')
      setNtpServers(ntpEntry['server-dns-names'] ?? '')
    }
  }, [ntpEntry])

  const isLoading = identity.isLoading || clock.isLoading || resource.isLoading

  const stageIdentityChanges = () => {
    if (identityEntry && hostname !== (identityEntry.name ?? '')) {
      panel.addChange({
        operation: 'set',
        path: '/system/identity',
        entryId: identityEntry['.id'],
        properties: { name: hostname },
        description: `Rename device to "${hostname}"`,
      })
    }
  }

  const stageTimeChanges = () => {
    // Clock timezone
    if (clockEntry && timezone !== (clockEntry['time-zone-name'] ?? '')) {
      panel.addChange({
        operation: 'set',
        path: '/system/clock',
        entryId: clockEntry['.id'],
        properties: { 'time-zone-name': timezone },
        description: `Set timezone to ${timezone}`,
      })
    }

    // NTP settings
    const ntpProps: Record<string, string> = {}
    if (ntpEntry) {
      if (ntpEnabled !== (ntpEntry.enabled ?? 'true')) ntpProps.enabled = ntpEnabled
      if (ntpServers !== (ntpEntry['server-dns-names'] ?? '')) ntpProps['server-dns-names'] = ntpServers
    }
    if (Object.keys(ntpProps).length > 0) {
      panel.addChange({
        operation: 'set',
        path: '/system/ntp/client',
        entryId: ntpEntry?.['.id'],
        properties: ntpProps,
        description: `Update NTP settings`,
      })
    }
  }

  const handleReboot = async () => {
    setRebooting(true)
    try {
      await configEditorApi.execute(tenantId, deviceId, '/system/reboot')
      toast.success(`Reboot command sent to ${hostname || 'device'}`)
    } catch {
      toast.error('Failed to send reboot command')
    } finally {
      setRebooting(false)
      setRebootDialogOpen(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading system configuration...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'Hostname', value: identityEntry?.name ?? 'Unknown' },
          { label: 'RouterOS', value: resourceEntry?.version ?? '\u2014' },
          { label: 'Board', value: resourceEntry?.['board-name'] ?? '\u2014' },
          { label: 'Uptime', value: resourceEntry?.uptime ?? '\u2014' },
        ]}
        isLoading={isLoading}
      />

      {/* Device Identity */}
      <SimpleFormSection icon={Settings} title="Device Identity" description="Set the router's name and identification">
        <SimpleFormField
          field={{
            key: 'name',
            label: 'Hostname',
            type: 'text',
            required: true,
            placeholder: 'e.g., Office-Router-1',
            help: 'A friendly name for this router, visible in the fleet dashboard',
          }}
          value={hostname}
          onChange={setHostname}
        />
        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={stageIdentityChanges}>
            Stage Changes
          </Button>
        </div>
      </SimpleFormSection>

      {/* Time & NTP */}
      <SimpleFormSection icon={Clock} title="Time & NTP" description="Configure the system clock and time synchronization">
        <SimpleFormField
          field={{
            key: 'timezone',
            label: 'Timezone',
            type: 'text',
            placeholder: 'America/New_York',
            help: 'IANA timezone identifier (e.g., America/New_York, Europe/London, Asia/Tokyo)',
          }}
          value={timezone}
          onChange={setTimezone}
        />
        <SimpleFormField
          field={{ key: 'ntp-enabled', label: 'NTP Enabled', type: 'boolean', help: 'Synchronize time from NTP servers' }}
          value={ntpEnabled}
          onChange={setNtpEnabled}
        />
        <SimpleFormField
          field={{
            key: 'ntp-servers',
            label: 'NTP Servers',
            type: 'text',
            placeholder: 'pool.ntp.org',
            help: 'Comma-separated NTP server hostnames',
          }}
          value={ntpServers}
          onChange={setNtpServers}
        />

        {clockEntry?.time && (
          <div className="flex items-center gap-2 text-xs text-text-muted pt-1">
            <Clock className="h-3 w-3" />
            <span>Current time: {clockEntry.date} {clockEntry.time}</span>
          </div>
        )}

        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={stageTimeChanges}>
            Stage Changes
          </Button>
        </div>
      </SimpleFormSection>

      {/* System Info (read-only) */}
      <SimpleFormSection icon={Info} title="System Information" description="Current system information (read-only)">
        <div className="space-y-0">
          <InfoRow label="Board" value={resourceEntry?.['board-name']} />
          <InfoRow label="RouterOS Version" value={resourceEntry?.version} />
          <InfoRow label="Architecture" value={resourceEntry?.['architecture-name']} />
          {resourceEntry?.cpu && <InfoRow label="CPU" value={resourceEntry.cpu} />}
          <InfoRow label="Total Memory" value={formatBytes(resourceEntry?.['total-memory'])} />
          <InfoRow label="Free Memory" value={formatBytes(resourceEntry?.['free-memory'])} />
          <InfoRow label="Total Disk" value={formatBytes(resourceEntry?.['total-hdd-space'])} />
          <InfoRow label="Free Disk" value={formatBytes(resourceEntry?.['free-hdd-space'])} />
          <InfoRow label="Uptime" value={resourceEntry?.uptime} />
        </div>
      </SimpleFormSection>

      {/* Maintenance */}
      <SimpleFormSection icon={AlertTriangle} title="Maintenance" description="System maintenance actions">
        <div className="flex items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setRebootDialogOpen(true)}
          >
            Reboot Device
          </Button>
          <span className="text-xs text-text-muted">
            Device will be unreachable for 30-90 seconds
          </span>
        </div>
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

      {/* Reboot confirmation dialog */}
      <Dialog open={rebootDialogOpen} onOpenChange={setRebootDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reboot Device</DialogTitle>
            <DialogDescription>
              Are you sure you want to reboot {hostname || 'this device'}? The device will be unreachable for 30-90 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRebootDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReboot}
              disabled={rebooting}
            >
              {rebooting ? 'Rebooting...' : 'Confirm Reboot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm font-mono text-text-primary">{value ?? '\u2014'}</span>
    </div>
  )
}
