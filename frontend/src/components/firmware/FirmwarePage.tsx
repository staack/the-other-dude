/**
 * FirmwarePage — firmware dashboard with version groups, upgrade buttons,
 * channel preferences, and upgrade progress tracking.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Download,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react'
import {
  firmwareApi,
  type DeviceFirmwareStatus,
  type FirmwareVersionGroup,
} from '@/lib/firmwareApi'
import { useUIStore } from '@/lib/store'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { UpgradeProgressModal } from './UpgradeProgressModal'
import { DeviceLink } from '@/components/ui/device-link'

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-xs text-text-muted mt-1">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upgrade confirmation dialog
// ---------------------------------------------------------------------------

function UpgradeDialog({
  open,
  onClose,
  tenantId,
  devices,
  targetVersion,
  channel,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  devices: DeviceFirmwareStatus[]
  targetVersion: string
  channel: string
}) {
  const queryClient = useQueryClient()
  const [confirmed, setConfirmed] = useState(false)
  const isMass = devices.length > 1

  // Check for major version change
  const hasMajorChange = devices.some((d) => {
    if (!d.routeros_version) return false
    const currentMajor = d.routeros_version.split('.')[0]
    const targetMajor = targetVersion.split('.')[0]
    return currentMajor !== targetMajor
  })

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      if (isMass) {
        return firmwareApi.startMassUpgrade(tenantId, {
          device_ids: devices.map((d) => d.id),
          target_version: targetVersion,
          channel,
          confirmed_major_upgrade: hasMajorChange ? confirmed : false,
        })
      } else {
        return firmwareApi.startUpgrade(tenantId, {
          device_id: devices[0].id,
          target_version: targetVersion,
          architecture: devices[0].architecture ?? '',
          channel,
          confirmed_major_upgrade: hasMajorChange ? confirmed : false,
        })
      }
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['firmware-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['upgrade-jobs'] })
      toast({ title: isMass ? 'Mass upgrade started' : 'Upgrade started' })
      onClose()

      // Open progress modal
      if ('rollout_group_id' in data) {
        setProgressRolloutId(data.rollout_group_id)
      } else if ('job_id' in data) {
        setProgressJobId(data.job_id)
      }
    },
    onError: () =>
      toast({ title: 'Failed to start upgrade', variant: 'destructive' }),
  })

  const [progressJobId, setProgressJobId] = useState<string | null>(null)
  const [progressRolloutId, setProgressRolloutId] = useState<string | null>(null)

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isMass ? 'Mass Firmware Upgrade' : 'Firmware Upgrade'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {isMass ? (
              <p className="text-sm text-text-secondary">
                Upgrade <span className="text-text-primary font-medium">{devices.length}</span>{' '}
                devices to RouterOS{' '}
                <span className="font-mono text-text-primary">{targetVersion}</span>.
              </p>
            ) : (
              <p className="text-sm text-text-secondary">
                Upgrade{' '}
                <span className="text-text-primary font-medium">{devices[0].hostname}</span>{' '}
                from{' '}
                <span className="font-mono text-text-secondary">
                  {devices[0].routeros_version ?? 'unknown'}
                </span>{' '}
                to{' '}
                <span className="font-mono text-text-primary">{targetVersion}</span>.
              </p>
            )}

            {isMass && (
              <div className="rounded border border-info/40 bg-info/10 p-3 text-xs text-info">
                Devices will be upgraded one at a time (sequential rollout). If any
                device fails, the rollout will pause automatically.
              </div>
            )}

            {hasMajorChange && (
              <div className="rounded border border-error/40 bg-error/10 p-3 space-y-2">
                <p className="text-xs text-error font-medium">
                  WARNING: Major version upgrade detected
                </p>
                <p className="text-xs text-error/80">
                  Upgrading across major versions (e.g., RouterOS 6 to 7) may cause
                  breaking changes. Ensure you have reviewed the MikroTik migration
                  guide before proceeding.
                </p>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(!!v)}
                  />
                  <span className="text-error">I understand the risks</span>
                </label>
              </div>
            )}

            <div className="rounded border border-border bg-panel p-3 text-xs text-text-secondary">
              A mandatory config backup will be taken before upgrading each device.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => upgradeMutation.mutate()}
                disabled={
                  upgradeMutation.isPending || (hasMajorChange && !confirmed)
                }
              >
                {upgradeMutation.isPending
                  ? 'Starting...'
                  : isMass
                    ? `Upgrade ${devices.length} devices`
                    : 'Upgrade'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {progressJobId && (
        <UpgradeProgressModal
          open={!!progressJobId}
          onClose={() => setProgressJobId(null)}
          tenantId={tenantId}
          jobId={progressJobId}
        />
      )}

      {progressRolloutId && (
        <UpgradeProgressModal
          open={!!progressRolloutId}
          onClose={() => setProgressRolloutId(null)}
          tenantId={tenantId}
          rolloutGroupId={progressRolloutId}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Version group card
// ---------------------------------------------------------------------------

function VersionGroupCard({
  group,
  tenantId,
  canUpgrade,
}: {
  group: FirmwareVersionGroup
  tenantId: string
  canUpgrade: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [upgradeTarget, setUpgradeTarget] = useState<DeviceFirmwareStatus[] | null>(null)

  // Determine the target version for outdated devices
  const firstOutdated = group.devices.find((d) => !d.is_up_to_date && d.latest_version)
  const latestVersion = firstOutdated?.latest_version ?? ''
  const channel = firstOutdated?.channel ?? 'stable'

  return (
    <>
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-panel transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )}

          <span className="font-mono text-sm text-text-primary">
            {group.version === 'unknown' ? 'Unknown' : `v${group.version}`}
          </span>

          {group.is_latest ? (
            <span className="text-[10px] bg-success/20 text-success border border-success/40 rounded px-1.5 py-0.5">
              latest
            </span>
          ) : group.version === 'unknown' ? (
            <span className="text-[10px] bg-elevated text-text-muted border border-border rounded px-1.5 py-0.5">
              unknown
            </span>
          ) : (
            <span className="text-[10px] bg-warning/20 text-warning border border-warning/40 rounded px-1.5 py-0.5">
              outdated
            </span>
          )}

          <span className="text-xs text-text-muted ml-auto">
            {group.count} device{group.count !== 1 ? 's' : ''}
          </span>

          {canUpgrade && !group.is_latest && group.version !== 'unknown' && latestVersion && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs ml-2"
              onClick={(e) => {
                e.stopPropagation()
                setUpgradeTarget(group.devices.filter((d) => !d.is_up_to_date))
              }}
            >
              Upgrade All to {latestVersion}
            </Button>
          )}
        </button>

        {expanded && (
          <div className="border-t border-border">
            {/* Table header */}
            <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] text-text-muted font-medium uppercase">
              <span className="flex-1">Hostname</span>
              <span className="w-28">Model</span>
              <span className="w-24">Architecture</span>
              <span className="w-24">Serial</span>
              <span className="w-20">Channel</span>
              <span className="w-20">Status</span>
              <span className="w-20" />
            </div>
            {group.devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center gap-3 px-4 py-2 border-t border-border/50 text-xs"
              >
                <span className="flex-1 text-text-secondary truncate">
                  <DeviceLink tenantId={tenantId} deviceId={device.id}>
                    {device.hostname}
                  </DeviceLink>
                </span>
                <span className="w-28 text-text-muted truncate">
                  {device.model ?? '—'}
                </span>
                <span className="w-24 text-text-muted font-mono">
                  {device.architecture ?? '—'}
                </span>
                <span className="w-24 text-text-muted font-mono">
                  {device.serial_number || '—'}
                </span>
                <span className="w-20 text-text-muted">{device.channel}</span>
                <span className="w-20">
                  {device.is_up_to_date ? (
                    <CheckCircle className="h-3.5 w-3.5 text-success" />
                  ) : device.routeros_version ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  ) : (
                    <HelpCircle className="h-3.5 w-3.5 text-text-muted" />
                  )}
                </span>
                <span className="w-20 text-right">
                  {canUpgrade && !device.is_up_to_date && device.latest_version && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      onClick={() => setUpgradeTarget([device])}
                    >
                      Upgrade
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {upgradeTarget && latestVersion && (
        <UpgradeDialog
          open={!!upgradeTarget}
          onClose={() => setUpgradeTarget(null)}
          tenantId={tenantId}
          devices={upgradeTarget}
          targetVersion={latestVersion}
          channel={channel}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function FirmwarePage() {
  const { user } = useAuth()
  const { selectedTenantId } = useUIStore()

  const tenantId = isSuperAdmin(user) ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  const { data: overview, isLoading } = useQuery({
    queryKey: ['firmware-overview', tenantId],
    queryFn: () => firmwareApi.getFirmwareOverview(tenantId),
    enabled: !!tenantId,
    refetchInterval: 60_000,
  })

  const summary = overview?.summary ?? { total: 0, up_to_date: 0, outdated: 0, unknown: 0 }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Download className="h-5 w-5 text-text-secondary" />
          <h1 className="text-lg font-semibold">Firmware</h1>
        </div>

      </div>

      {!tenantId ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="h-10 w-10 text-text-muted mb-3" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to view firmware status.
          </p>
        </div>
      ) : isLoading ? (
        <TableSkeleton />
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Devices" value={summary.total} color="text-text-primary" />
            <StatCard label="Up to Date" value={summary.up_to_date} color="text-success" />
            <StatCard label="Outdated" value={summary.outdated} color="text-warning" />
            <StatCard label="Unknown" value={summary.unknown} color="text-text-muted" />
          </div>

          {/* Version groups */}
          <div>
            <h2 className="text-sm font-medium text-text-secondary mb-3">Version Groups</h2>
            {overview?.version_groups.length === 0 ? (
              <EmptyState
                icon={Download}
                title="All firmware up to date"
                description="All devices are running the latest firmware version."
              />
            ) : (
              <div className="space-y-2">
                {overview?.version_groups.map((group) => (
                  <VersionGroupCard
                    key={group.version}
                    group={group}
                    tenantId={tenantId}
                    canUpgrade={canWrite(user)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
