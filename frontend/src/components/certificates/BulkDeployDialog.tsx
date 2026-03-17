/**
 * BulkDeployDialog -- Multi-device certificate deployment dialog.
 *
 * Shows a checkbox list of devices without deployed certs, with Select All / Deselect All.
 * On deploy, calls bulkDeploy API and shows progress + results summary.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Layers,
  Loader2,
  CheckCircle,
  XCircle,
  Check,
} from 'lucide-react'
import { certificatesApi } from '@/lib/certificatesApi'
import { devicesApi, type DeviceResponse } from '@/lib/api'
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

type BulkStep = 'select' | 'deploying' | 'results'

interface BulkResult {
  success: number
  failed: number
  errors: Array<{ device_id: string; error: string }>
}

interface BulkDeployDialogProps {
  open: boolean
  onClose: () => void
  tenantId: string
}

export function BulkDeployDialog({
  open,
  onClose,
  tenantId,
}: BulkDeployDialogProps) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<BulkStep>('select')
  const [result, setResult] = useState<BulkResult | null>(null)

  // Fetch devices
  const { data: deviceList = [] } = useQuery({
    queryKey: ['devices-for-cert', tenantId],
    queryFn: async () => {
      const result = await devicesApi.list(tenantId)
      return (result as { items?: DeviceResponse[] }).items ?? (result as DeviceResponse[])
    },
    enabled: !!tenantId && open,
  })

  // Fetch existing device certs to filter
  const { data: existingCerts = [] } = useQuery({
    queryKey: ['deviceCerts', tenantId],
    queryFn: () => certificatesApi.getDeviceCerts(undefined, tenantId),
    enabled: !!tenantId && open,
  })

  const deployedDeviceIds = new Set(
    existingCerts
      .filter((c) => c.status === 'deployed' || c.status === 'deploying')
      .map((c) => c.device_id),
  )

  const availableDevices = (deviceList as DeviceResponse[]).filter(
    (d) => !deployedDeviceIds.has(d.id),
  )

  const toggleDevice = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(availableDevices.map((d) => d.id)))
  }

  const deselectAll = () => {
    setSelected(new Set())
  }

  const handleDeploy = async () => {
    if (selected.size === 0) return

    setStep('deploying')
    try {
      const responses = await certificatesApi.bulkDeploy(Array.from(selected), tenantId)
      const succeeded = responses.filter((r) => r.success).length
      const failed = responses.filter((r) => !r.success)

      const bulkResult: BulkResult = {
        success: succeeded,
        failed: failed.length,
        errors: failed.map((f) => ({
          device_id: f.device_id,
          error: f.error ?? 'Unknown error',
        })),
      }

      setResult(bulkResult)
      setStep('results')
      void queryClient.invalidateQueries({ queryKey: ['deviceCerts'] })

      if (failed.length === 0) {
        toast({ title: `${succeeded} certificate(s) deployed successfully` })
      } else {
        toast({
          title: `${succeeded} deployed, ${failed.length} failed`,
          variant: 'destructive',
        })
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setResult({
        success: 0,
        failed: selected.size,
        errors: [
          {
            device_id: 'bulk',
            error: err?.response?.data?.detail || 'Bulk deployment failed',
          },
        ],
      })
      setStep('results')
      toast({ title: 'Bulk deployment failed', variant: 'destructive' })
    }
  }

  const handleClose = () => {
    onClose()
    setSelected(new Set())
    setStep('select')
    setResult(null)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Certificate Deployment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {step === 'select' && (
            <>
              <p className="text-sm text-text-secondary">
                Select devices to sign and deploy TLS certificates in batch.
              </p>

              {availableDevices.length === 0 ? (
                <div className="rounded-lg border border-border bg-elevated/50 p-4 text-center">
                  <CheckCircle className="h-6 w-6 text-success mx-auto mb-2" />
                  <p className="text-sm font-medium text-text-primary">
                    All devices have certificates
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Every device already has a deployed certificate.
                  </p>
                </div>
              ) : (
                <>
                  {/* Select All / Deselect All */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">
                      {selected.size} of {availableDevices.length} selected
                    </span>
                    <div className="flex gap-2">
                      <button
                        className="text-xs text-accent hover:underline"
                        onClick={selectAll}
                      >
                        Select All
                      </button>
                      <button
                        className="text-xs text-text-muted hover:underline"
                        onClick={deselectAll}
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {/* Device list */}
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {availableDevices.map((d: DeviceResponse) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-elevated/30 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selected.has(d.id)}
                          onCheckedChange={() => toggleDevice(d.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-text-primary block truncate">
                            {d.hostname}
                          </span>
                          <span className="text-xs text-text-muted">
                            {d.ip_address}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'text-[10px] uppercase px-1.5 py-0.5 rounded',
                            d.status === 'online'
                              ? 'bg-success/10 text-success'
                              : 'bg-text-muted/10 text-text-muted',
                          )}
                        >
                          {d.status}
                        </span>
                      </label>
                    ))}
                  </div>

                  <Button
                    className="w-full"
                    disabled={selected.size === 0}
                    onClick={handleDeploy}
                  >
                    <Layers className="h-4 w-4 mr-2" />
                    Deploy to {selected.size} device
                    {selected.size !== 1 ? 's' : ''}
                  </Button>
                </>
              )}
            </>
          )}

          {step === 'deploying' && (
            <div className="py-8 text-center space-y-3">
              <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
              <p className="text-sm font-medium text-text-primary">
                Deploying certificates...
              </p>
              <p className="text-xs text-text-muted">
                Signing and deploying to {selected.size} device
                {selected.size !== 1 ? 's' : ''}. This may take a moment.
              </p>
            </div>
          )}

          {step === 'results' && result && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
                  <CheckCircle className="h-6 w-6 text-success mx-auto mb-1" />
                  <p className="text-2xl font-bold text-success">
                    {result.success}
                  </p>
                  <p className="text-xs text-text-muted">Succeeded</p>
                </div>
                <div
                  className={cn(
                    'rounded-lg border p-4 text-center',
                    result.failed > 0
                      ? 'border-error/30 bg-error/5'
                      : 'border-border bg-surface',
                  )}
                >
                  <XCircle
                    className={cn(
                      'h-6 w-6 mx-auto mb-1',
                      result.failed > 0 ? 'text-error' : 'text-text-muted',
                    )}
                  />
                  <p
                    className={cn(
                      'text-2xl font-bold',
                      result.failed > 0 ? 'text-error' : 'text-text-muted',
                    )}
                  >
                    {result.failed}
                  </p>
                  <p className="text-xs text-text-muted">Failed</p>
                </div>
              </div>

              {/* Error details */}
              {result.errors.length > 0 && (
                <div className="rounded-lg border border-error/30 bg-error/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-error">
                    Failed deployments:
                  </p>
                  {result.errors.map((err, i) => (
                    <div
                      key={i}
                      className="text-xs text-text-secondary flex items-start gap-2"
                    >
                      <XCircle className="h-3 w-3 text-error mt-0.5 flex-shrink-0" />
                      <span>{err.error}</span>
                    </div>
                  ))}
                </div>
              )}

              <Button className="w-full" onClick={handleClose}>
                <Check className="h-4 w-4 mr-2" />
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
