/**
 * RollbackAlert — Banner offering a one-click rollback after a recent config push.
 *
 * The rollback it offers works by pushing the previous backup over SSH, so it
 * needs the device to be REACHABLE. This banner used to render only when
 * `deviceStatus === 'offline'` — the single state in which the button it
 * offers cannot do anything — so the affordance existed exactly when it was
 * useless and was hidden whenever it would have worked.
 *
 * It now shows whenever there is a recent push to undo, and adapts: an
 * actionable button while the device is reachable, and an explanation of what
 * to do instead while it is not.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { configApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'

interface RollbackAlertProps {
  tenantId: string
  deviceId: string
  deviceStatus: string
  /** Whether there's a recent push alert for this device */
  hasRecentPushAlert: boolean
}

export function RollbackAlert({
  tenantId,
  deviceId,
  deviceStatus,
  hasRecentPushAlert,
}: RollbackAlertProps) {
  const queryClient = useQueryClient()

  const rollbackMutation = useMutation({
    mutationFn: () => configApi.emergencyRollback(tenantId, deviceId),
    onSuccess: () => {
      toast.success('Rollback successful')
      queryClient.invalidateQueries({ queryKey: ['config-backups', tenantId, deviceId] })
    },
    onError: () => {
      toast.error('Rollback failed')
    },
  })

  if (!hasRecentPushAlert) {
    return null
  }

  const isOffline = deviceStatus === 'offline'

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
        <div>
          <p className="text-sm font-medium text-warning">
            {isOffline
              ? 'Device went offline after a config change'
              : 'Config was changed recently'}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            {isOffline
              ? 'Rollback pushes the previous config over SSH, so it needs the device to be reachable. ' +
                'While it is offline, recover it locally — a restore point was saved to the device before the push.'
              : 'You can roll back to the config captured before that change.'}
          </p>
        </div>
      </div>
      {!isOffline && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => rollbackMutation.mutate()}
          disabled={rollbackMutation.isPending}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          {rollbackMutation.isPending ? 'Rolling back...' : 'Rollback Now'}
        </Button>
      )}
    </div>
  )
}
