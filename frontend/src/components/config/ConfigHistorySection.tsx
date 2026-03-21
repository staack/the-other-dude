import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { configHistoryApi } from '@/lib/api'
import { DiffViewer } from './DiffViewer'

interface ConfigHistorySectionProps {
  tenantId: string
  deviceId: string
  deviceName: string
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

function LineDelta({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="text-xs font-mono">
      <span className="text-success">+{added}</span>
      <span className="text-text-muted mx-0.5">/</span>
      <span className="text-error">-{removed}</span>
    </span>
  )
}

export function ConfigHistorySection({ tenantId, deviceId, deviceName }: ConfigHistorySectionProps) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null)

  async function handleDownload(snapshotId: string, collectedAt: string) {
    const snapshot = await configHistoryApi.getSnapshot(tenantId, deviceId, snapshotId)
    const timestamp = new Date(collectedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `router-${deviceName}-${timestamp}.rsc`
    const blob = new Blob([snapshot.config_text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const { data: changes, isLoading } = useQuery({
    queryKey: ['config-history', tenantId, deviceId],
    queryFn: () => configHistoryApi.list(tenantId, deviceId),
    refetchInterval: 60_000,
  })

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-text-muted" />
        <h3 className="text-sm font-medium text-text-muted">Configuration History</h3>
      </div>

      {selectedSnapshotId && (
        <div className="mb-3">
          <DiffViewer
            tenantId={tenantId}
            deviceId={deviceId}
            snapshotId={selectedSnapshotId}
            onClose={() => setSelectedSnapshotId(null)}
          />
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : !changes || changes.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-text-muted">No configuration changes recorded yet.</span>
        </div>
      ) : (
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-3 top-4 bottom-4 w-px bg-elevated" />

          <div className="space-y-1">
            {changes.map((entry) => (
              <div
                key={entry.id}
                className="relative flex items-start gap-3 pl-8 pr-3 py-2.5 rounded-lg cursor-pointer hover:bg-elevated/50 transition-colors"
                onClick={() => setSelectedSnapshotId(entry.snapshot_id)}
              >
                {/* Timeline dot */}
                <div className="absolute left-2 top-3.5 h-2 w-2 rounded-full border border-border bg-elevated" />

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="text-xs font-mono">{entry.component}</Badge>
                    <LineDelta added={entry.lines_added} removed={entry.lines_removed} />
                  </div>
                  <p className="text-sm text-text-primary">{entry.summary}</p>
                  <span
                    className="text-xs text-text-muted"
                    title={formatAbsoluteTime(entry.created_at)}
                  >
                    {formatRelativeTime(entry.created_at)}
                  </span>
                </div>

                {/* Download button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(entry.snapshot_id, entry.created_at)
                  }}
                  className="p-1 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
                  title="Download .rsc"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
