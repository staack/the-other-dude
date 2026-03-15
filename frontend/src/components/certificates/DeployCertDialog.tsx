/**
 * DeployCertDialog -- Dialog for signing and deploying a certificate to a single device.
 *
 * Flow: select device -> sign cert -> deploy to device -> done.
 * Shows progress states: Signing... -> Deploying... -> Done.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { certificatesApi } from '@/lib/certificatesApi'
import { devicesApi, type DeviceResponse } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'

type DeployStep = 'idle' | 'signing' | 'deploying' | 'done' | 'error'

interface DeployCertDialogProps {
  open: boolean
  onClose: () => void
  tenantId: string
}

export function DeployCertDialog({
  open,
  onClose,
  tenantId,
}: DeployCertDialogProps) {
  const queryClient = useQueryClient()
  const [selectedDevice, setSelectedDevice] = useState('')
  const [validityDays, setValidityDays] = useState('730')
  const [step, setStep] = useState<DeployStep>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Fetch devices for the selector
  const { data: deviceList = [] } = useQuery({
    queryKey: ['devices-for-cert', tenantId],
    queryFn: async () => {
      const result = await devicesApi.list(tenantId)
      // The list endpoint returns { items, total, ... } or an array
      return (result as { items?: DeviceResponse[] }).items ?? (result as DeviceResponse[])
    },
    enabled: !!tenantId && open,
  })

  // Fetch existing device certs to filter out devices that already have deployed certs
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

  const handleDeploy = async () => {
    if (!selectedDevice) return

    try {
      // Step 1: Sign
      setStep('signing')
      const cert = await certificatesApi.signCert(
        selectedDevice,
        Number(validityDays) || 730,
        tenantId,
      )

      // Step 2: Deploy
      setStep('deploying')
      const result = await certificatesApi.deployCert(cert.id, tenantId)

      if (result.success) {
        setStep('done')
        void queryClient.invalidateQueries({ queryKey: ['deviceCerts'] })
        toast({ title: 'Certificate signed and deployed' })
        // Auto-close after a brief delay
        setTimeout(() => {
          onClose()
          resetState()
        }, 1500)
      } else {
        setStep('error')
        setErrorMsg(result.error ?? 'Deployment failed')
        toast({ title: result.error ?? 'Deployment failed', variant: 'destructive' })
      }
    } catch (e: unknown) {
      setStep('error')
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail || 'Failed to deploy certificate'
      setErrorMsg(detail)
      toast({ title: detail, variant: 'destructive' })
    }
  }

  const resetState = () => {
    setSelectedDevice('')
    setValidityDays('730')
    setStep('idle')
    setErrorMsg('')
  }

  const handleClose = () => {
    onClose()
    resetState()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sign & Deploy Certificate</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {step === 'idle' && (
            <>
              <p className="text-sm text-text-secondary">
                Select a device to sign a TLS certificate and deploy it
                automatically.
              </p>

              {availableDevices.length === 0 ? (
                <div className="rounded-lg border border-border bg-elevated/50 p-4 text-center">
                  <CheckCircle className="h-6 w-6 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-text-primary">
                    All devices have certificates
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Every device already has a deployed certificate. Use rotate to
                    renew.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <Label>Device</Label>
                    <Select
                      value={selectedDevice}
                      onValueChange={setSelectedDevice}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a device..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDevices.map((d: DeviceResponse) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.hostname} ({d.ip_address})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Validity (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={validityDays}
                      onChange={(e) => setValidityDays(e.target.value)}
                    />
                    <p className="text-xs text-text-muted mt-1">
                      Default: 730 days (2 years)
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    disabled={!selectedDevice}
                    onClick={handleDeploy}
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Sign & Deploy
                  </Button>
                </>
              )}
            </>
          )}

          {step === 'signing' && (
            <div className="py-8 text-center space-y-3">
              <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
              <p className="text-sm font-medium text-text-primary">
                Creating secure certificate for this device...
              </p>
              <p className="text-xs text-text-muted">
                Generating device certificate with your CA
              </p>
            </div>
          )}

          {step === 'deploying' && (
            <div className="py-8 text-center space-y-3">
              <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
              <p className="text-sm font-medium text-text-primary">
                Deploying to device...
              </p>
              <p className="text-xs text-text-muted">
                Uploading certificate via SFTP and configuring TLS
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="py-8 text-center space-y-3">
              <CheckCircle className="h-8 w-8 text-green-500 mx-auto" />
              <p className="text-sm font-medium text-text-primary">
                Certificate deployed successfully
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="py-8 text-center space-y-3">
              <XCircle className="h-8 w-8 text-error mx-auto" />
              <p className="text-sm font-medium text-text-primary">
                Deployment failed
              </p>
              <p className="text-xs text-text-muted">{errorMsg}</p>
              <Button variant="outline" size="sm" onClick={resetState}>
                Try Again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
