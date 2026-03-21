import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Flag, RefreshCw } from 'lucide-react'
import { configApi } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { BackupTimeline } from './BackupTimeline'
import { RestoreButton } from './RestoreButton'

// Lazy import to avoid loading the diff view CSS until it's needed
import { ConfigDiffViewer } from './ConfigDiffViewer'

interface ConfigTabProps {
  tenantId: string
  deviceId: string
  deviceHostname: string
  active?: boolean
}

export function ConfigTab({
  tenantId,
  deviceId,
  deviceHostname,
  active = true,
}: ConfigTabProps) {
  const queryClient = useQueryClient()
  const [selectedShas, setSelectedShas] = useState<string[]>([])
  const [diffShas, setDiffShas] = useState<[string, string] | null>(null)

  // Restore dialog state
  const [restoreSha, setRestoreSha] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const { data: backups, isLoading } = useQuery({
    queryKey: ['config-backups', tenantId, deviceId],
    queryFn: () => configApi.listBackups(tenantId, deviceId),
    enabled: active,
  })

  const triggerMutation = useMutation({
    mutationFn: () => configApi.triggerBackup(tenantId, deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['config-backups', tenantId, deviceId],
      })
      toast({ title: 'Backup created', description: 'Config backup completed successfully.' })
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Backup failed'
      toast({ title: 'Backup failed', description: message, variant: 'destructive' })
    },
  })

  const checkpointMutation = useMutation({
    mutationFn: () => configApi.createCheckpoint(tenantId, deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['config-backups', tenantId, deviceId],
      })
      toast({ title: 'Checkpoint created', description: 'Restore point saved successfully.' })
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to create checkpoint'
      toast({ title: 'Checkpoint failed', description: message, variant: 'destructive' })
    },
  })

  const handleSelectSha = (sha: string) => {
    setSelectedShas((prev) => {
      if (prev.includes(sha)) {
        return prev.filter((s) => s !== sha)
      }
      if (prev.length >= 2) {
        // Replace the oldest selection
        return [prev[1], sha]
      }
      return [...prev, sha]
    })
    // Clear diff view when selection changes
    setDiffShas(null)
  }

  const handleCompare = (sha1: string, sha2: string) => {
    setDiffShas([sha1, sha2])
  }

  const handleRestore = (sha: string) => {
    setRestoreSha(sha)
    setRestoreOpen(true)
  }

  const handleRestoreComplete = () => {
    void queryClient.invalidateQueries({
      queryKey: ['config-backups', tenantId, deviceId],
    })
    setSelectedShas([])
    setDiffShas(null)
  }

  // Find backup entry for restore dialog
  const restoreEntry = restoreSha
    ? backups?.find((b) => b.commit_sha === restoreSha)
    : null

  return (
    <div className="mt-4 space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">Config Backups</h3>
        <div className="flex items-center gap-2">
          {selectedShas.length > 0 && (
            <span className="text-xs text-text-muted">
              {selectedShas.length} selected
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkpointMutation.mutate()}
            disabled={checkpointMutation.isPending}
            title="Save a restore point before making changes"
          >
            {checkpointMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Flag className="h-3.5 w-3.5" />
                Checkpoint
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
          >
            {triggerMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Backing up...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Backup Now
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main layout: timeline left, diff right */}
      <div className="flex gap-4">
        {/* Timeline panel */}
        <div className="w-72 flex-shrink-0">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-lg border border-border bg-panel animate-pulse"
                />
              ))}
            </div>
          ) : !backups || backups.length === 0 ? (
            <div className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-text-muted">
              No backups yet. Click &lsquo;Backup Now&rsquo; to create the first backup.
            </div>
          ) : (
            <BackupTimeline
              backups={backups}
              selectedShas={selectedShas}
              onSelectSha={handleSelectSha}
              onRestore={handleRestore}
              onCompare={handleCompare}
            />
          )}
        </div>

        {/* Diff panel */}
        <div className="flex-1 min-w-0">
          {diffShas ? (
            <ConfigDiffViewer
              tenantId={tenantId}
              deviceId={deviceId}
              oldSha={diffShas[0]}
              newSha={diffShas[1]}
              oldDate={
                backups?.find((b) => b.commit_sha === diffShas[0])?.created_at ?? ''
              }
              newDate={
                backups?.find((b) => b.commit_sha === diffShas[1])?.created_at ?? ''
              }
              isEncrypted={
                (backups?.find((b) => b.commit_sha === diffShas[0])?.encryption_tier ?? null) != null ||
                (backups?.find((b) => b.commit_sha === diffShas[1])?.encryption_tier ?? null) != null
              }
            />
          ) : (
            <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-text-muted h-full flex items-center justify-center min-h-32">
              {selectedShas.length < 2
                ? 'Select two backups from the timeline to compare'
                : 'Click "Compare selected" to view the diff'}
            </div>
          )}
        </div>
      </div>

      {/* Restore dialog */}
      {restoreSha && (
        <RestoreButton
          tenantId={tenantId}
          deviceId={deviceId}
          commitSha={restoreSha}
          backupDate={
            restoreEntry
              ? new Date(restoreEntry.created_at).toLocaleString()
              : restoreSha.slice(0, 7)
          }
          deviceHostname={deviceHostname}
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          onComplete={handleRestoreComplete}
        />
      )}
    </div>
  )
}
