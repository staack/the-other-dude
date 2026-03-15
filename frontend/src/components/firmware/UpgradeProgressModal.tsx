/**
 * UpgradeProgressModal — real-time upgrade progress tracking.
 * Supports single-device and mass rollout views.
 * Uses SSE firmware-progress events for live updates with polling as fallback.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Circle,
  Clock,
  Download,
  Upload,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  PauseCircle,
} from 'lucide-react'
import { firmwareApi } from '@/lib/firmwareApi'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUS_CONFIG: Record<
  string,
  { icon: React.FC<{ className?: string }>; label: string; color: string }
> = {
  pending: { icon: Circle, label: 'Pending', color: 'text-text-muted' },
  scheduled: { icon: Clock, label: 'Scheduled', color: 'text-info' },
  downloading: { icon: Download, label: 'Downloading NPK', color: 'text-info' },
  uploading: { icon: Upload, label: 'Uploading to device', color: 'text-info' },
  rebooting: { icon: RefreshCw, label: 'Rebooting', color: 'text-warning' },
  verifying: { icon: Search, label: 'Verifying version', color: 'text-warning' },
  completed: { icon: CheckCircle, label: 'Completed', color: 'text-success' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-error' },
  paused: { icon: PauseCircle, label: 'Paused', color: 'text-warning' },
}

const STATUS_STEPS = [
  'pending',
  'downloading',
  'uploading',
  'rebooting',
  'verifying',
  'completed',
]

function StatusStep({ step, currentStatus }: { step: string; currentStatus: string }) {
  const config = STATUS_CONFIG[step] ?? STATUS_CONFIG.pending
  const Icon = config.icon

  const currentIndex = STATUS_STEPS.indexOf(currentStatus)
  const stepIndex = STATUS_STEPS.indexOf(step)

  const isActive = step === currentStatus
  const isDone = currentStatus === 'completed' || (stepIndex < currentIndex && currentStatus !== 'failed')
  const isFailed = currentStatus === 'failed' && isActive

  return (
    <div className="flex items-center gap-2">
      <Icon
        className={cn(
          'h-4 w-4',
          isDone ? 'text-success' : isActive ? config.color : isFailed ? 'text-error' : 'text-text-muted',
          isActive && !isFailed && 'animate-pulse',
        )}
      />
      <span
        className={cn(
          'text-xs',
          isDone ? 'text-success' : isActive ? 'text-text-primary' : 'text-text-muted',
        )}
      >
        {config.label}
      </span>
    </div>
  )
}

function SingleUpgradeProgress({
  tenantId,
  jobId,
}: {
  tenantId: string
  jobId: string
}) {
  // ── SSE live state ────────────────────────────────────────────────────
  const [sseStatus, setSSEStatus] = useState<string | null>(null)
  const [sseMessage, setSSEMessage] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        job_id?: string
        device_id?: string
        stage: string
        message?: string
      }
      if (detail.job_id === jobId) {
        setSSEStatus(detail.stage)
        setSSEMessage(detail.message ?? null)
      }
    }
    window.addEventListener('firmware-progress', handler)
    return () => window.removeEventListener('firmware-progress', handler)
  }, [jobId])

  // ── Polling fallback (slower interval since SSE provides live updates) ─
  const { data: job } = useQuery({
    queryKey: ['upgrade-job', tenantId, jobId],
    queryFn: () => firmwareApi.getUpgradeJob(tenantId, jobId),
    refetchInterval: (query) => {
      const status = sseStatus ?? query.state.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 15_000 // Slower poll as backup when SSE is active
    },
  })

  if (!job) return <div className="text-sm text-text-muted py-4">Loading...</div>

  // Use SSE status if available, fall back to polled status
  const displayStatus = sseStatus ?? job.status

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-secondary">
        {job.device_hostname ?? job.device_id.slice(0, 8)} — upgrading to{' '}
        <span className="text-text-primary font-mono">{job.target_version}</span>
      </div>

      <div className="space-y-2">
        {STATUS_STEPS.map((step) => (
          <StatusStep key={step} step={step} currentStatus={displayStatus} />
        ))}
      </div>

      {/* SSE live message */}
      {sseMessage && (
        <div className="text-xs text-info animate-pulse">
          {sseMessage}
        </div>
      )}

      {job.error_message && (
        <div className="rounded border border-error/40 bg-error/10 p-3 text-xs text-error">
          {job.error_message}
        </div>
      )}

      {job.started_at && (
        <div className="text-xs text-text-muted">
          Started: {new Date(job.started_at).toLocaleString()}
          {job.completed_at && (
            <>
              {' — '}Finished: {new Date(job.completed_at).toLocaleString()}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MassUpgradeProgress({
  tenantId,
  rolloutGroupId,
  onResume,
  onAbort,
}: {
  tenantId: string
  rolloutGroupId: string
  onResume?: () => void
  onAbort?: () => void
}) {
  // ── SSE live message for current device ────────────────────────────────
  const [sseMessage, setSSEMessage] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        job_id?: string
        device_id?: string
        stage: string
        message?: string
      }
      // Any firmware progress event is relevant to mass upgrade
      setSSEMessage(detail.message ?? `Stage: ${detail.stage}`)
    }
    window.addEventListener('firmware-progress', handler)
    return () => window.removeEventListener('firmware-progress', handler)
  }, [])

  const { data: rollout } = useQuery({
    queryKey: ['rollout-status', tenantId, rolloutGroupId],
    queryFn: () => firmwareApi.getRolloutStatus(tenantId, rolloutGroupId),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 5_000
      if (data.completed + data.failed >= data.total) return false
      if (data.paused > 0) return false
      return 15_000 // Slower poll as backup when SSE is active
    },
  })

  if (!rollout) return <div className="text-sm text-text-muted py-4">Loading...</div>

  const progressPct =
    rollout.total > 0
      ? Math.round(((rollout.completed + rollout.failed) / rollout.total) * 100)
      : 0

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
          <span>
            {rollout.completed}/{rollout.total} devices
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-elevated overflow-hidden">
          <div
            className="h-full rounded-full bg-success transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-xs">
        <span className="text-success">Completed: {rollout.completed}</span>
        {rollout.failed > 0 && <span className="text-error">Failed: {rollout.failed}</span>}
        {rollout.paused > 0 && (
          <span className="text-warning">Paused: {rollout.paused}</span>
        )}
        {rollout.pending > 0 && <span className="text-text-muted">Pending: {rollout.pending}</span>}
      </div>

      {rollout.current_device && (
        <div className="text-xs text-info">
          Currently upgrading: {rollout.current_device}
        </div>
      )}

      {/* SSE live message */}
      {sseMessage && (
        <div className="text-xs text-info animate-pulse">
          {sseMessage}
        </div>
      )}

      {/* Device list */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden max-h-48 overflow-y-auto">
        {rollout.jobs.map((job) => {
          const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending
          const Icon = config.icon
          return (
            <div
              key={job.id}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 last:border-0 text-xs"
            >
              <Icon className={cn('h-3.5 w-3.5', config.color)} />
              <span className="text-text-secondary flex-1">
                {job.device_hostname ?? job.device_id.slice(0, 8)}
              </span>
              <span className={cn('text-[10px]', config.color)}>{config.label}</span>
            </div>
          )
        })}
      </div>

      {/* Actions for paused rollout */}
      {rollout.paused > 0 && (
        <div className="flex gap-2">
          {onResume && (
            <Button size="sm" variant="outline" onClick={onResume}>
              Resume Rollout
            </Button>
          )}
          {onAbort && (
            <Button size="sm" variant="destructive" onClick={onAbort}>
              Abort Remaining
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function UpgradeProgressModal({
  open,
  onClose,
  tenantId,
  jobId,
  rolloutGroupId,
  onResume,
  onAbort,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  jobId?: string
  rolloutGroupId?: string
  onResume?: () => void
  onAbort?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {rolloutGroupId ? 'Mass Upgrade Progress' : 'Upgrade Progress'}
          </DialogTitle>
        </DialogHeader>

        {jobId && <SingleUpgradeProgress tenantId={tenantId} jobId={jobId} />}
        {rolloutGroupId && (
          <MassUpgradeProgress
            tenantId={tenantId}
            rolloutGroupId={rolloutGroupId}
            onResume={onResume}
            onAbort={onAbort}
          />
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
