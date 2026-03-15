/**
 * TemplatePushWizard -- multi-step dialog for pushing a template to devices.
 * Steps: Target Selection -> Variable Input -> Preview -> Confirm & Push -> Progress
 */

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
import { cn } from '@/lib/utils'
import {
  templatesApi,
  type TemplateResponse,
} from '@/lib/templatesApi'
import { deviceGroupsApi, metricsApi } from '@/lib/api'
import { PushProgressPanel } from './PushProgressPanel'

interface TemplatePushWizardProps {
  open: boolean
  onClose: () => void
  tenantId: string
  template: TemplateResponse
}

type WizardStep = 'targets' | 'variables' | 'preview' | 'confirm' | 'progress'

export function TemplatePushWizard({ open, onClose, tenantId, template }: TemplatePushWizardProps) {
  const [step, setStep] = useState<WizardStep>('targets')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set())
  const [variables, setVariables] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {}
    for (const v of template.variables) {
      if (v.default) defaults[v.name] = v.default
    }
    return defaults
  })
  const [previewDevice, setPreviewDevice] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [rolloutId, setRolloutId] = useState<string | null>(null)

  // Fetch devices
  const { data: devices } = useQuery({
    queryKey: ['fleet-devices', tenantId],
    queryFn: () => metricsApi.fleetSummary(tenantId),
    enabled: open,
  })

  // Fetch groups
  const { data: groups } = useQuery({
    queryKey: ['device-groups', tenantId],
    queryFn: () => deviceGroupsApi.list(tenantId),
    enabled: open,
  })

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: ({ deviceId }: { deviceId: string }) =>
      templatesApi.preview(tenantId, template.id, deviceId, variables),
    onSuccess: (data, { deviceId }) => {
      setPreviews((prev) => ({ ...prev, [deviceId]: data.rendered }))
    },
  })

  // Push mutation
  const pushMutation = useMutation({
    mutationFn: () =>
      templatesApi.push(tenantId, template.id, Array.from(selectedDeviceIds), variables),
    onSuccess: (data) => {
      setRolloutId(data.rollout_id)
      setStep('progress')
    },
  })

  const selectedDevices = devices?.filter((d) => selectedDeviceIds.has(d.id)) ?? []

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleGroupSelect = (_groupId: string) => {
    // For now, just select all online devices. In a real implementation,
    // we'd load group members from the API. Here we select all devices
    // as a simplified approach.
    if (devices) {
      const onlineIds = new Set(devices.filter((d) => d.status === 'online').map((d) => d.id))
      setSelectedDeviceIds(onlineIds)
    }
  }

  const toggleDevice = (deviceId: string) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev)
      if (next.has(deviceId)) {
        next.delete(deviceId)
      } else {
        next.add(deviceId)
      }
      return next
    })
  }

  const goToPreview = () => {
    setStep('preview')
    // Trigger preview for first selected device
    if (selectedDevices.length > 0) {
      const firstId = selectedDevices[0].id
      setPreviewDevice(firstId)
      if (!previews[firstId]) {
        previewMutation.mutate({ deviceId: firstId })
      }
    }
  }

  const selectPreviewDevice = (deviceId: string) => {
    setPreviewDevice(deviceId)
    if (!previews[deviceId]) {
      previewMutation.mutate({ deviceId })
    }
  }

  const handleClose = () => {
    setStep('targets')
    setSelectedDeviceIds(new Set())
    setVariables(() => {
      const defaults: Record<string, string> = {}
      for (const v of template.variables) {
        if (v.default) defaults[v.name] = v.default
      }
      return defaults
    })
    setPreviews({})
    setRolloutId(null)
    onClose()
  }

  const userVars = template.variables.filter((v) => v.name !== 'device')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-surface border-border text-text-primary">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            Push Template: {template.name}
            {step !== 'progress' && (
              <span className="text-[10px] text-text-muted font-normal">
                Step {['targets', 'variables', 'preview', 'confirm'].indexOf(step) + 1} of 4
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Target Selection */}
        {step === 'targets' && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">Select devices to push the template to.</div>

            {groups && groups.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Select Group</Label>
                <Select onValueChange={handleGroupSelect}>
                  <SelectTrigger className="bg-elevated/50 border-border text-xs">
                    <SelectValue placeholder="Select a device group..." />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">
                Devices ({selectedDeviceIds.size} selected)
              </Label>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-white/5">
                {devices?.map((device) => (
                  <label
                    key={device.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-surface cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedDeviceIds.has(device.id)}
                      onCheckedChange={() => toggleDevice(device.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-primary truncate">{device.hostname}</div>
                      <div className="text-[10px] text-text-muted">{device.ip_address}</div>
                    </div>
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full flex-shrink-0',
                        device.status === 'online' ? 'bg-success' : 'bg-error',
                      )}
                    />
                  </label>
                )) ?? (
                  <div className="px-3 py-6 text-xs text-text-muted text-center">Loading devices...</div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                className="text-xs gap-1"
                disabled={selectedDeviceIds.size === 0}
                onClick={() => setStep(userVars.length > 0 ? 'variables' : 'preview')}
              >
                Next
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Variable Input */}
        {step === 'variables' && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              Provide values for template variables. Built-in device variables are auto-populated per device.
            </div>

            <div className="text-[10px] text-text-muted bg-surface rounded px-3 py-2">
              Auto-populated: {'{{ device.hostname }}'}, {'{{ device.ip }}'}, {'{{ device.model }}'}
            </div>

            <div className="space-y-3">
              {userVars.map((v) => (
                <div key={v.name} className="space-y-1">
                  <Label className="text-xs text-text-secondary">
                    {v.name}
                    {v.description && (
                      <span className="ml-2 text-text-muted">-- {v.description}</span>
                    )}
                  </Label>
                  {v.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={variables[v.name] === 'true'}
                        onCheckedChange={(c) =>
                          setVariables((prev) => ({ ...prev, [v.name]: c ? 'true' : 'false' }))
                        }
                      />
                      <span className="text-xs text-text-secondary">{variables[v.name] ?? 'false'}</span>
                    </div>
                  ) : (
                    <Input
                      value={variables[v.name] ?? ''}
                      onChange={(e) =>
                        setVariables((prev) => ({ ...prev, [v.name]: e.target.value }))
                      }
                      placeholder={
                        v.type === 'ip'
                          ? '192.168.1.1'
                          : v.type === 'subnet'
                            ? '192.168.1.0/24'
                            : v.type === 'integer'
                              ? '0'
                              : v.default ?? ''
                      }
                      type={v.type === 'integer' ? 'number' : 'text'}
                      className="h-8 text-xs bg-elevated/50 border-border font-mono"
                    />
                  )}
                  <div className="text-[10px] text-text-muted">
                    type: {v.type}
                    {v.default && ` | default: ${v.default}`}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={() => setStep('targets')}
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </Button>
              <Button size="sm" className="text-xs gap-1" onClick={goToPreview}>
                Next
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              Preview the rendered template for each device.
            </div>

            <div className="flex gap-2 flex-wrap">
              {selectedDevices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => selectPreviewDevice(d.id)}
                  className={cn(
                    'text-xs px-2 py-1 rounded transition-colors',
                    previewDevice === d.id
                      ? 'bg-elevated text-text-primary'
                      : 'bg-surface text-text-secondary hover:text-text-secondary',
                  )}
                >
                  {d.hostname}
                </button>
              ))}
            </div>

            {previewDevice && previews[previewDevice] && (
              <pre className="text-xs font-mono bg-background border border-border rounded-lg p-3 text-success overflow-x-auto max-h-64 whitespace-pre-wrap">
                {previews[previewDevice]}
              </pre>
            )}

            {previewDevice && !previews[previewDevice] && previewMutation.isPending && (
              <div className="flex items-center justify-center py-8 text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading preview...
              </div>
            )}

            {previewMutation.isError && (
              <div className="text-xs text-error bg-error/10 rounded px-3 py-2">
                Preview failed: {previewMutation.error instanceof Error ? previewMutation.error.message : 'Unknown error'}
              </div>
            )}

            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={() => setStep(userVars.length > 0 ? 'variables' : 'targets')}
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </Button>
              <Button size="sm" className="text-xs gap-1" onClick={() => setStep('confirm')}>
                Next
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm & Push */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-xs text-warning leading-relaxed">
                This will push configuration to <strong>{selectedDeviceIds.size}</strong> device(s).
                Each device will be backed up before changes are applied. If a device becomes
                unreachable after push, it will automatically revert.
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-text-secondary">Template: {template.name}</div>
              <div className="text-xs text-text-secondary">
                Devices: {selectedDevices.map((d) => d.hostname).join(', ')}
              </div>
              {Object.entries(variables).length > 0 && (
                <div className="text-xs text-text-secondary">
                  Variables:{' '}
                  {Object.entries(variables)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={() => setStep('preview')}
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={() => pushMutation.mutate()}
                disabled={pushMutation.isPending}
              >
                {pushMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Push to {selectedDeviceIds.size} Device(s)
              </Button>
            </div>

            {pushMutation.isError && (
              <div className="text-xs text-error bg-error/10 rounded px-3 py-2">
                Push failed: {pushMutation.error instanceof Error ? pushMutation.error.message : 'Unknown error'}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Progress */}
        {step === 'progress' && rolloutId && (
          <PushProgressPanel tenantId={tenantId} rolloutId={rolloutId} onClose={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}
