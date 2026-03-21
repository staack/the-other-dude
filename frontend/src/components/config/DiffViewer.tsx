import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { configHistoryApi } from '@/lib/api'

interface DiffViewerProps {
  tenantId: string
  deviceId: string
  snapshotId: string
  onClose: () => void
}

function classifyLine(line: string): string {
  if (line.startsWith('@@')) return 'bg-blue-900/20 text-blue-300'
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-text-muted'
  if (line.startsWith('+')) return 'bg-green-900/30 text-green-300'
  if (line.startsWith('-')) return 'bg-red-900/30 text-red-300'
  return 'text-text-primary'
}

export function DiffViewer({ tenantId, deviceId, snapshotId, onClose }: DiffViewerProps) {
  const { data: diff, isLoading, isError } = useQuery({
    queryKey: ['config-diff', tenantId, deviceId, snapshotId],
    queryFn: () => configHistoryApi.getDiff(tenantId, deviceId, snapshotId),
  })

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-text-muted">Config Diff</h3>
          {diff && (
            <span className="text-xs font-mono">
              <span className="text-success">+{diff.lines_added}</span>
              <span className="text-text-muted mx-0.5">/</span>
              <span className="text-error">-{diff.lines_removed}</span>
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-elevated transition-colors text-text-muted hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-8 text-center">
          <span className="text-[9px] text-text-muted">Loading&hellip;</span>
        </div>
      ) : isError || !diff ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-text-muted">No diff available.</span>
        </div>
      ) : (
        <div className="overflow-auto max-h-[60vh] rounded border border-border bg-background">
          <div className="font-mono text-xs whitespace-pre">
            {diff.diff_text.split('\n').map((line, i) => (
              <div key={i} className={`px-3 py-0.5 ${classifyLine(line)}`}>
                {line || '\u00A0'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
