/**
 * PushProgressPanel -- real-time per-device push status display.
 * Polls the push status API every 3 seconds until all devices
 * reach a terminal state (committed/reverted/failed).
 */

import { useQuery } from '@tanstack/react-query'
import { CheckCircle, XCircle, AlertTriangle, Loader2, Clock } from 'lucide-react'
import { templatesApi } from '@/lib/templatesApi'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils'

interface PushProgressPanelProps {
  tenantId: string
  rolloutId: string
  onClose: () => void
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-text-muted', label: 'Pending' },
  pushing: { icon: Loader2, color: 'text-info', label: 'Pushing' },
  committed: { icon: CheckCircle, color: 'text-success', label: 'Committed' },
  reverted: { icon: AlertTriangle, color: 'text-warning', label: 'Reverted' },
  failed: { icon: XCircle, color: 'text-error', label: 'Failed' },
}

const TERMINAL_STATUSES = new Set(['committed', 'reverted', 'failed'])

export function PushProgressPanel({ tenantId, rolloutId, onClose }: PushProgressPanelProps) {
  const { data } = useQuery({
    queryKey: ['push-status', rolloutId],
    queryFn: () => templatesApi.pushStatus(tenantId, rolloutId),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? []
      const allTerminal = jobs.length > 0 && jobs.every((j) => TERMINAL_STATUSES.has(j.status))
      return allTerminal ? false : 3000
    },
  })

  const jobs = data?.jobs ?? []
  const total = jobs.length
  const committed = jobs.filter((j) => j.status === 'committed').length
  const failed = jobs.filter((j) => j.status === 'failed').length
  const reverted = jobs.filter((j) => j.status === 'reverted').length
  const pending = jobs.filter((j) => j.status === 'pending').length
  const allDone = jobs.length > 0 && jobs.every((j) => TERMINAL_STATUSES.has(j.status))
  const hasFailed = failed > 0 || reverted > 0

  // Progress percentage
  const completedCount = committed + failed + reverted
  const progressPct = total > 0 ? Math.round((completedCount / total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-primary font-medium">Push Progress</div>
        <div className="text-xs text-text-muted">
          {completedCount} / {total} devices
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-elevated/50 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-500 rounded-full',
            hasFailed ? 'bg-error' : 'bg-success',
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Status message */}
      {allDone && !hasFailed && (
        <div className="text-xs text-success bg-success/10 rounded-lg px-3 py-2">
          Push complete -- all {committed} devices configured successfully
        </div>
      )}

      {allDone && hasFailed && pending > 0 && (
        <div className="text-xs text-warning bg-warning/10 rounded-lg px-3 py-2">
          Push paused -- {failed + reverted} device(s) failed/reverted.{' '}
          {pending} device(s) remain pending.
        </div>
      )}

      {allDone && hasFailed && pending === 0 && (
        <div className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">
          Push complete with errors -- {failed} failed, {reverted} reverted out of {total} devices.
        </div>
      )}

      {/* Per-device list */}
      <div className="space-y-1">
        {jobs.map((job) => {
          const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending
          const Icon = config.icon

          return (
            <div
              key={job.device_id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-surface/50 px-3 py-2"
            >
              <Icon
                className={cn(
                  'h-4 w-4 flex-shrink-0',
                  config.color,
                  job.status === 'pushing' && 'animate-spin',
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-primary truncate">{job.hostname}</div>
                {job.error_message && (
                  <div className="text-[10px] text-error truncate">{job.error_message}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded', config.color, 'bg-elevated/50')}>
                  {config.label}
                </span>
                {job.completed_at && (
                  <span className="text-[10px] text-text-muted">{formatDateTime(job.completed_at)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {allDone && (
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="text-xs text-text-secondary hover:text-text-primary transition-colors underline"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
