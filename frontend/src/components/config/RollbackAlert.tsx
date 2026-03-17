/**
 * RollbackAlert — Banner shown when a device went offline after a config push.
 * Offers one-click emergency rollback.
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
      toast.success('Emergency rollback successful')
      queryClient.invalidateQueries({ queryKey: ['config-backups', tenantId, deviceId] })
    },
    onError: () => {
      toast.error('Emergency rollback failed')
    },
  })

  if (deviceStatus !== 'offline' || !hasRecentPushAlert) {
    return null
  }

  return (
    <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-error shrink-0" />
        <div>
          <p className="text-sm font-medium text-error">
            Device went offline after config change
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            A config change was made recently. You can rollback to the last known good config.
          </p>
        </div>
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => rollbackMutation.mutate()}
        disabled={rollbackMutation.isPending}
      >
        <RotateCcw className="h-4 w-4 mr-1.5" />
        {rollbackMutation.isPending ? 'Rolling back...' : 'Rollback Now'}
      </Button>
    </div>
  )
}
