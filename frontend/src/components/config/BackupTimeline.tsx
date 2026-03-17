import { Lock, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import type { ConfigBackupEntry } from '@/lib/api'
import { cn } from '@/lib/utils'

interface BackupTimelineProps {
  backups: ConfigBackupEntry[]
  selectedShas: string[]
  onSelectSha: (sha: string) => void
  onRestore: (sha: string) => void
  onCompare: (sha1: string, sha2: string) => void
}

function triggerBadgeClass(type: ConfigBackupEntry['trigger_type']) {
  switch (type) {
    case 'scheduled':
      return 'border-info/50 bg-info/10 text-info'
    case 'manual':
      return 'border-success/50 bg-success/10 text-success'
    case 'pre-restore':
      return 'border-warning/50 bg-warning/10 text-warning'
    case 'checkpoint':
      return 'border-accent/50 bg-accent/10 text-accent'
    case 'config-change':
      return 'border-orange-500/50 bg-orange-500/10 text-orange-500'
    default:
      return 'border-muted bg-muted/10 text-text-muted'
  }
}

function triggerLabel(type: ConfigBackupEntry['trigger_type']) {
  switch (type) {
    case 'scheduled':
      return 'Scheduled'
    case 'manual':
      return 'Manual'
    case 'pre-restore':
      return 'Pre-restore'
    case 'checkpoint':
      return 'Checkpoint'
    case 'config-change':
      return 'Config Change'
    default:
      return type
  }
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function formatAbsoluteTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString()
}

function LineDelta({
  added,
  removed,
  isFirst,
}: {
  added: number | null
  removed: number | null
  isFirst: boolean
}) {
  if (isFirst) {
    return <span className="text-xs text-text-muted italic">Initial backup</span>
  }
  return (
    <span className="text-xs font-mono">
      {added !== null && (
        <span className="text-success">+{added}</span>
      )}
      {added !== null && removed !== null && (
        <span className="text-text-muted mx-0.5">/</span>
      )}
      {removed !== null && (
        <span className="text-error">-{removed}</span>
      )}
    </span>
  )
}

export function BackupTimeline({
  backups,
  selectedShas,
  onSelectSha,
  onRestore,
  onCompare,
}: BackupTimelineProps) {
  const canCompare = selectedShas.length === 2

  if (backups.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      {canCompare && (
        <div className="flex justify-end">
          <button
            onClick={() => onCompare(selectedShas[0], selectedShas[1])}
            className="text-xs px-3 py-1 rounded border border-info/50 bg-info/10 text-info hover:bg-info/20 transition-colors"
          >
            Compare selected
          </button>
        </div>
      )}

      {/* Vertical timeline */}
      <div className="relative">
        {/* Connecting line */}
        <div className="absolute left-3 top-4 bottom-4 w-px bg-elevated" />

        <div className="space-y-1">
          {backups.map((backup, idx) => {
            const isSelected = selectedShas.includes(backup.commit_sha)
            const isFirst = idx === backups.length - 1

            return (
              <div
                key={backup.id}
                className={cn(
                  'relative flex items-start gap-3 pl-8 pr-3 py-2.5 rounded-lg border cursor-pointer transition-colors',
                  isSelected
                    ? 'border-info/50 bg-info/10'
                    : 'border-transparent hover:border-border hover:bg-elevated/50',
                )}
                onClick={() => {
                  if (selectedShas.length >= 2 && !selectedShas.includes(backup.commit_sha)) {
                    toast({ title: 'Maximum 2 backups can be selected for comparison. Deselect one first.' })
                    return
                  }
                  onSelectSha(backup.commit_sha)
                }}
              >
                {/* Timeline dot */}
                <div
                  className={cn(
                    'absolute left-2 top-3.5 h-2 w-2 rounded-full border',
                    isSelected
                      ? 'border-info bg-accent'
                      : 'border-border bg-elevated',
                  )}
                />

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={cn('text-xs', triggerBadgeClass(backup.trigger_type))}>
                      {triggerLabel(backup.trigger_type)}
                    </Badge>
                    {backup.encryption_tier != null && (
                      <span
                        className="inline-flex items-center gap-0.5 text-xs text-info"
                        title={`Encrypted (Tier ${backup.encryption_tier})`}
                      >
                        <Lock className="h-3 w-3" />
                      </span>
                    )}
                    <LineDelta
                      added={backup.lines_added}
                      removed={backup.lines_removed}
                      isFirst={isFirst}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs text-text-muted"
                      title={formatAbsoluteTime(backup.created_at)}
                    >
                      {formatRelativeTime(backup.created_at)}
                    </span>
                    <span className="text-xs text-text-muted font-mono">
                      {backup.commit_sha.slice(0, 7)}
                    </span>
                  </div>
                </div>

                {/* Restore button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRestore(backup.commit_sha)
                  }}
                  className="flex-shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
                  title="Restore this version"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
