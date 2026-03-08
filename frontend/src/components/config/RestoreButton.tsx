import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { configApi } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { RestorePreview } from './RestorePreview'

interface RestoreButtonProps {
  tenantId: string
  deviceId: string
  commitSha: string
  backupDate: string
  deviceHostname: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

type RestorePhase = 'preview' | 'pushing' | 'verifying' | 'done'

export function RestoreButton({
  tenantId,
  deviceId,
  commitSha,
  backupDate,
  deviceHostname,
  open,
  onOpenChange,
  onComplete,
}: RestoreButtonProps) {
  const [phase, setPhase] = useState<RestorePhase>('preview')

  const handleRestore = async () => {
    setPhase('pushing')

    // Show verifying state after 30s (halfway through the 60s settle wait)
    const verifyTimer = setTimeout(() => {
      setPhase('verifying')
    }, 30_000)

    try {
      const result = await configApi.restore(tenantId, deviceId, commitSha)
      clearTimeout(verifyTimer)
      setPhase('done')

      if (result.status === 'committed') {
        toast({
          title: 'Config restored',
          description: result.message,
        })
        onComplete()
        onOpenChange(false)
      } else if (result.status === 'reverted') {
        toast({
          title: 'Restore reverted',
          description: result.message,
          variant: 'destructive',
        })
        onComplete()
        onOpenChange(false)
      } else {
        toast({
          title: 'Restore failed',
          description: result.message,
          variant: 'destructive',
        })
        onOpenChange(false)
      }
    } catch (err: unknown) {
      clearTimeout(verifyTimer)
      setPhase('preview')
      const message =
        err instanceof Error ? err.message : 'Restore operation failed'
      toast({
        title: 'Restore failed',
        description: message,
        variant: 'destructive',
      })
    }
  }

  const isRunning = phase === 'pushing' || phase === 'verifying'

  const handleOpenChange = (nextOpen: boolean) => {
    if (isRunning) return
    if (!nextOpen) setPhase('preview')
    onOpenChange(nextOpen)
  }

  const statusText = () => {
    switch (phase) {
      case 'pushing':
        return 'Pushing config to device...'
      case 'verifying':
        return 'Waiting for verification (~60s total)...'
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore Config</DialogTitle>
          <DialogDescription>
            This will push the config from{' '}
            <span className="text-text-primary font-medium">{backupDate}</span> to{' '}
            <span className="text-text-primary font-medium">{deviceHostname}</span>.
            The system will create a safety backup and auto-revert if the device
            becomes unreachable.
          </DialogDescription>
        </DialogHeader>

        {phase === 'preview' && (
          <RestorePreview
            tenantId={tenantId}
            deviceId={deviceId}
            commitSha={commitSha}
            onProceed={() => void handleRestore()}
            onCancel={() => handleOpenChange(false)}
          />
        )}

        {isRunning && (
          <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
            <span>{statusText()}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
