/**
 * BatchConfigPanel -- Multi-device batch configuration wizard.
 *
 * Three-step workflow:
 * 1. Select target devices (online only)
 * 2. Define the configuration change
 * 3. Review and execute sequentially with per-device status
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Play,
  Wifi,
  Shield,
  Network,
  Globe,
  Server,
  Gauge,
} from 'lucide-react'
import { devicesApi, type DeviceResponse } from '@/lib/api'
import { configEditorApi } from '@/lib/configEditorApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { DeviceLink } from '@/components/ui/device-link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OperationType =
  | 'add-firewall-rule'
  | 'set-dns-servers'
  | 'add-vlan'
  | 'add-simple-queue'
  | 'add-ip-address'
  | 'add-static-dns'

interface BatchChange {
  operationType: OperationType
  path: string
  operation: 'add' | 'set'
  properties: Record<string, string>
  description: string
}

type DeviceStatus = 'pending' | 'applying' | 'success' | 'failed'

interface DeviceExecState {
  deviceId: string
  hostname: string
  ipAddress: string
  status: DeviceStatus
  error?: string
}

interface BatchConfigPanelProps {
  tenantId: string
}

// ---------------------------------------------------------------------------
// Operation definitions
// ---------------------------------------------------------------------------

const OPERATIONS: { value: OperationType; label: string; icon: React.FC<{ className?: string }> }[] = [
  { value: 'add-firewall-rule', label: 'Add Firewall Rule', icon: Shield },
  { value: 'set-dns-servers', label: 'Set DNS Servers', icon: Globe },
  { value: 'add-vlan', label: 'Add VLAN', icon: Network },
  { value: 'add-simple-queue', label: 'Add Simple Queue', icon: Gauge },
  { value: 'add-ip-address', label: 'Add IP Address', icon: Server },
  { value: 'add-static-dns', label: 'Add Static DNS Entry', icon: Wifi },
]

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = ['Select Devices', 'Define Change', 'Review & Execute']

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, idx) => {
        const stepNum = idx + 1
        const isActive = stepNum === currentStep
        const isComplete = stepNum < currentStep

        return (
          <div key={label} className="flex items-center gap-2">
            {idx > 0 && (
              <div
                className={cn(
                  'w-8 h-px',
                  isComplete ? 'bg-success' : 'bg-border',
                )}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium',
                  isActive && 'bg-accent text-white',
                  isComplete && 'bg-success text-white',
                  !isActive && !isComplete && 'bg-elevated text-text-muted',
                )}
              >
                {isComplete ? <CheckCircle className="h-4 w-4" /> : stepNum}
              </div>
              <span
                className={cn(
                  'text-sm hidden sm:inline',
                  isActive ? 'text-text-primary font-medium' : 'text-text-muted',
                )}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1: Select Devices
// ---------------------------------------------------------------------------

function DeviceSelector({
  tenantId,
  selectedIds,
  onSelectionChange,
}: {
  tenantId: string
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['devices', tenantId, 'batch-list'],
    queryFn: () => devicesApi.list(tenantId, { page_size: 500 }),
    enabled: !!tenantId,
  })

  const devices = data?.items ?? []
  const onlineDevices = devices.filter((d) => d.status === 'online')

  const toggleDevice = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onSelectionChange(next)
  }

  const selectAllOnline = () => {
    onSelectionChange(new Set(onlineDevices.map((d) => d.id)))
  }

  const deselectAll = () => {
    onSelectionChange(new Set())
  }

  if (isLoading) return <TableSkeleton rows={5} />

  if (devices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-text-muted text-sm">No devices found for this tenant.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          {selectedIds.size} device{selectedIds.size !== 1 ? 's' : ''} selected
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAllOnline}>
            Select All Online ({onlineDevices.length})
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="outline" size="sm" onClick={deselectAll}>
              Deselect All
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-elevated/50">
              <th className="w-10 px-3 py-2" />
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Hostname</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">IP Address</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Status</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Model</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const isOnline = device.status === 'online'
              const isSelected = selectedIds.has(device.id)

              return (
                <tr
                  key={device.id}
                  className={cn(
                    'border-b border-border/50 last:border-0 transition-colors',
                    isSelected && 'bg-accent/5',
                    isOnline ? 'cursor-pointer hover:bg-elevated/30' : 'opacity-50',
                  )}
                  onClick={() => isOnline && toggleDevice(device.id)}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleDevice(device.id)}
                      disabled={!isOnline}
                      aria-label={`Select ${device.hostname}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <DeviceLink tenantId={tenantId} deviceId={device.id}>{device.hostname}</DeviceLink>
                  </td>
                  <td className="px-3 py-2 font-mono text-text-secondary">{device.ip_address}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded',
                        isOnline
                          ? 'text-success bg-success/10'
                          : 'text-error bg-error/10',
                      )}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', isOnline ? 'bg-success' : 'bg-error')} />
                      {device.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{device.model ?? '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Define Change
// ---------------------------------------------------------------------------

function ChangeDefiner({
  operationType,
  onOperationTypeChange,
  formData,
  onFormDataChange,
}: {
  operationType: OperationType | null
  onOperationTypeChange: (op: OperationType) => void
  formData: Record<string, string>
  onFormDataChange: (data: Record<string, string>) => void
}) {
  const setField = (key: string, value: string) => {
    onFormDataChange({ ...formData, [key]: value })
  }

  const field = (key: string, label: string, opts?: { placeholder?: string; type?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs text-text-secondary">{label}</Label>
      <Input
        value={formData[key] ?? ''}
        onChange={(e) => setField(key, e.target.value)}
        placeholder={opts?.placeholder}
        type={opts?.type ?? 'text'}
        className="h-8 text-sm"
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs text-text-secondary">Operation Type</Label>
        <Select value={operationType ?? ''} onValueChange={(v) => onOperationTypeChange(v as OperationType)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Select an operation..." />
          </SelectTrigger>
          <SelectContent>
            {OPERATIONS.map((op) => {
              const Icon = op.icon
              return (
                <SelectItem key={op.value} value={op.value}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {op.label}
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {operationType && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          {operationType === 'add-firewall-rule' && (
            <>
              <h4 className="text-sm font-medium text-text-secondary">Firewall Rule</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-text-secondary">Chain</Label>
                  <Select value={formData.chain ?? 'input'} onValueChange={(v) => setField('chain', v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="input">input</SelectItem>
                      <SelectItem value="forward">forward</SelectItem>
                      <SelectItem value="output">output</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-text-secondary">Action</Label>
                  <Select value={formData.action ?? 'accept'} onValueChange={(v) => setField('action', v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accept">accept</SelectItem>
                      <SelectItem value="drop">drop</SelectItem>
                      <SelectItem value="reject">reject</SelectItem>
                      <SelectItem value="log">log</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {field('src-address', 'Source Address', { placeholder: '0.0.0.0/0' })}
                {field('dst-address', 'Dest Address', { placeholder: '0.0.0.0/0' })}
                <div className="space-y-1">
                  <Label className="text-xs text-text-secondary">Protocol</Label>
                  <Select value={formData.protocol ?? ''} onValueChange={(v) => setField('protocol', v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">tcp</SelectItem>
                      <SelectItem value="udp">udp</SelectItem>
                      <SelectItem value="icmp">icmp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {field('dst-port', 'Dest Port', { placeholder: '80,443' })}
                {field('comment', 'Comment', { placeholder: 'Batch rule' })}
              </div>
            </>
          )}

          {operationType === 'set-dns-servers' && (
            <>
              <h4 className="text-sm font-medium text-text-secondary">DNS Servers</h4>
              {field('servers', 'DNS Servers (comma-separated)', { placeholder: '8.8.8.8,8.8.4.4' })}
              <div className="flex items-center gap-2 mt-2">
                <Checkbox
                  checked={formData['allow-remote-requests'] === 'yes'}
                  onCheckedChange={(checked) =>
                    setField('allow-remote-requests', checked ? 'yes' : 'no')
                  }
                />
                <Label className="text-xs text-text-secondary">Allow remote requests</Label>
              </div>
            </>
          )}

          {operationType === 'add-vlan' && (
            <>
              <h4 className="text-sm font-medium text-text-secondary">VLAN</h4>
              <div className="grid grid-cols-2 gap-3">
                {field('name', 'Name', { placeholder: 'vlan100' })}
                {field('vlan-id', 'VLAN ID', { placeholder: '100', type: 'number' })}
                {field('interface', 'Interface', { placeholder: 'bridge1' })}
              </div>
            </>
          )}

          {operationType === 'add-simple-queue' && (
            <>
              <h4 className="text-sm font-medium text-text-secondary">Simple Queue</h4>
              <div className="grid grid-cols-2 gap-3">
                {field('name', 'Name', { placeholder: 'queue1' })}
                {field('target', 'Target', { placeholder: '192.168.1.0/24' })}
                {field('max-limit', 'Max Limit (upload/download)', { placeholder: '10M/10M' })}
                {field('comment', 'Comment', { placeholder: 'Batch queue' })}
              </div>
            </>
          )}

          {operationType === 'add-ip-address' && (
            <>
              <h4 className="text-sm font-medium text-text-secondary">IP Address</h4>
              <div className="grid grid-cols-2 gap-3">
                {field('address', 'Address (CIDR)', { placeholder: '192.168.1.1/24' })}
                {field('interface', 'Interface', { placeholder: 'ether1' })}
                {field('comment', 'Comment', { placeholder: 'Batch IP' })}
              </div>
            </>
          )}

          {operationType === 'add-static-dns' && (
            <>
              <h4 className="text-sm font-medium text-text-secondary">Static DNS Entry</h4>
              <div className="grid grid-cols-2 gap-3">
                {field('name', 'Name', { placeholder: 'router.local' })}
                {field('address', 'Address', { placeholder: '192.168.1.1' })}
                {field('type', 'Type', { placeholder: 'A' })}
                {field('comment', 'Comment', { placeholder: 'Batch DNS' })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Build batch change from form data
// ---------------------------------------------------------------------------

function buildBatchChange(
  operationType: OperationType,
  formData: Record<string, string>,
): BatchChange | null {
  const clean = (obj: Record<string, string>) => {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v && v.trim()) result[k] = v.trim()
    }
    return result
  }

  switch (operationType) {
    case 'add-firewall-rule': {
      const props = clean({
        chain: formData.chain || 'input',
        action: formData.action || 'accept',
        ...(formData['src-address'] ? { 'src-address': formData['src-address'] } : {}),
        ...(formData['dst-address'] ? { 'dst-address': formData['dst-address'] } : {}),
        ...(formData.protocol ? { protocol: formData.protocol } : {}),
        ...(formData['dst-port'] ? { 'dst-port': formData['dst-port'] } : {}),
        ...(formData.comment ? { comment: formData.comment } : {}),
      })
      return {
        operationType,
        path: '/ip/firewall/filter',
        operation: 'add',
        properties: props,
        description: `Add firewall ${props.chain}/${props.action} rule`,
      }
    }
    case 'set-dns-servers': {
      if (!formData.servers?.trim()) {
        toast({ title: 'DNS servers required', variant: 'destructive' })
        return null
      }
      return {
        operationType,
        path: '/ip/dns',
        operation: 'set',
        properties: clean({
          servers: formData.servers,
          'allow-remote-requests': formData['allow-remote-requests'] || 'no',
        }),
        description: `Set DNS servers to ${formData.servers}`,
      }
    }
    case 'add-vlan': {
      const vlanId = formData['vlan-id']?.trim()
      const iface = formData.interface?.trim()
      if (!vlanId || !iface) {
        toast({ title: 'VLAN ID and interface are required', variant: 'destructive' })
        return null
      }
      return {
        operationType,
        path: '/interface/vlan',
        operation: 'add',
        properties: clean({
          name: formData.name || `vlan${vlanId}`,
          'vlan-id': vlanId,
          interface: iface,
        }),
        description: `Add VLAN ${vlanId} on ${iface}`,
      }
    }
    case 'add-simple-queue': {
      const target = formData.target?.trim()
      if (!target) {
        toast({ title: 'Queue target is required', variant: 'destructive' })
        return null
      }
      return {
        operationType,
        path: '/queue/simple',
        operation: 'add',
        properties: clean({
          name: formData.name || 'batch-queue',
          target,
          ...(formData['max-limit'] ? { 'max-limit': formData['max-limit'] } : {}),
          ...(formData.comment ? { comment: formData.comment } : {}),
        }),
        description: `Add simple queue for ${target}`,
      }
    }
    case 'add-ip-address': {
      const address = formData.address?.trim()
      const iface = formData.interface?.trim()
      if (!address || !iface) {
        toast({ title: 'Address and interface are required', variant: 'destructive' })
        return null
      }
      return {
        operationType,
        path: '/ip/address',
        operation: 'add',
        properties: clean({
          address,
          interface: iface,
          ...(formData.comment ? { comment: formData.comment } : {}),
        }),
        description: `Add IP ${address} on ${iface}`,
      }
    }
    case 'add-static-dns': {
      const name = formData.name?.trim()
      const addr = formData.address?.trim()
      if (!name || !addr) {
        toast({ title: 'Name and address are required', variant: 'destructive' })
        return null
      }
      return {
        operationType,
        path: '/ip/dns/static',
        operation: 'add',
        properties: clean({
          name,
          address: addr,
          ...(formData.type ? { type: formData.type } : {}),
          ...(formData.comment ? { comment: formData.comment } : {}),
        }),
        description: `Add static DNS ${name} -> ${addr}`,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3: Review & Execute
// ---------------------------------------------------------------------------

function ExecutionPanel({
  tenantId,
  change,
  devices,
  execStates,
  isRunning,
  isComplete,
  onExecute,
}: {
  tenantId: string
  change: BatchChange
  devices: DeviceResponse[]
  execStates: DeviceExecState[]
  isRunning: boolean
  isComplete: boolean
  onExecute: () => void
}) {
  const successCount = execStates.filter((s) => s.status === 'success').length
  const failedCount = execStates.filter((s) => s.status === 'failed').length

  return (
    <div className="space-y-4">
      {/* Change description */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h4 className="text-sm font-medium text-text-secondary mb-1">Change to Apply</h4>
        <p className="text-sm text-text-primary">{change.description}</p>
        <p className="text-xs text-text-muted mt-1 font-mono">
          {change.path} {change.operation}{' '}
          {Object.entries(change.properties)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}
        </p>
      </div>

      {/* Execute button */}
      {!isRunning && !isComplete && (
        <Button onClick={onExecute} className="w-full">
          <Play className="h-4 w-4 mr-2" />
          Execute on {devices.length} device{devices.length !== 1 ? 's' : ''}
        </Button>
      )}

      {/* Summary */}
      {isComplete && (
        <div className="rounded-lg border border-border bg-surface p-4 flex items-center gap-4">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">{successCount} succeeded</span>
          </div>
          {failedCount > 0 && (
            <div className="flex items-center gap-2 text-error">
              <XCircle className="h-5 w-5" />
              <span className="text-sm font-medium">{failedCount} failed</span>
            </div>
          )}
        </div>
      )}

      {/* Device status table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-elevated/50">
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Hostname</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">IP Address</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Status</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Error</th>
            </tr>
          </thead>
          <tbody>
            {execStates.map((state) => (
              <tr key={state.deviceId} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 font-medium">
                  <DeviceLink tenantId={tenantId} deviceId={state.deviceId}>{state.hostname}</DeviceLink>
                </td>
                <td className="px-3 py-2 font-mono text-text-secondary">{state.ipAddress}</td>
                <td className="px-3 py-2">
                  <StatusIcon status={state.status} />
                </td>
                <td className="px-3 py-2 text-xs text-error max-w-xs truncate">
                  {state.error ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: DeviceStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <Clock className="h-3.5 w-3.5" /> Pending
        </span>
      )
    case 'applying':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-accent">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying
        </span>
      )
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <CheckCircle className="h-3.5 w-3.5" /> Success
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-error">
          <XCircle className="h-3.5 w-3.5" /> Failed
        </span>
      )
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BatchConfigPanel({ tenantId }: BatchConfigPanelProps) {
  const [step, setStep] = useState(1)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set())
  const [operationType, setOperationType] = useState<OperationType | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [batchChange, setBatchChange] = useState<BatchChange | null>(null)
  const [execStates, setExecStates] = useState<DeviceExecState[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  // Load all devices for the execution step
  const { data: deviceData } = useQuery({
    queryKey: ['devices', tenantId, 'batch-list'],
    queryFn: () => devicesApi.list(tenantId, { page_size: 500 }),
    enabled: !!tenantId,
  })

  const allDevices = deviceData?.items ?? []
  const selectedDevices = allDevices.filter((d) => selectedDeviceIds.has(d.id))

  const handleNext = () => {
    if (step === 1) {
      if (selectedDeviceIds.size === 0) {
        toast({ title: 'Select at least one device', variant: 'destructive' })
        return
      }
      setStep(2)
    } else if (step === 2) {
      if (!operationType) {
        toast({ title: 'Select an operation type', variant: 'destructive' })
        return
      }
      const change = buildBatchChange(operationType, formData)
      if (!change) return
      setBatchChange(change)
      // Initialize exec states
      setExecStates(
        selectedDevices.map((d) => ({
          deviceId: d.id,
          hostname: d.hostname,
          ipAddress: d.ip_address,
          status: 'pending' as DeviceStatus,
        })),
      )
      setStep(3)
    }
  }

  const handleBack = () => {
    if (step === 2) setStep(1)
    if (step === 3 && !isRunning) {
      setStep(2)
      setBatchChange(null)
      setExecStates([])
      setIsComplete(false)
    }
  }

  const handleExecute = useCallback(async () => {
    if (!batchChange || isRunning) return
    setIsRunning(true)

    for (let i = 0; i < selectedDevices.length; i++) {
      const device = selectedDevices[i]

      // Set to applying
      setExecStates((prev) =>
        prev.map((s) =>
          s.deviceId === device.id ? { ...s, status: 'applying' as DeviceStatus } : s,
        ),
      )

      try {
        if (batchChange.operation === 'add') {
          await configEditorApi.addEntry(
            tenantId,
            device.id,
            batchChange.path,
            batchChange.properties,
          )
        } else {
          // set operation (e.g., DNS servers)
          await configEditorApi.setEntry(
            tenantId,
            device.id,
            batchChange.path,
            '',
            batchChange.properties,
          )
        }

        setExecStates((prev) =>
          prev.map((s) =>
            s.deviceId === device.id ? { ...s, status: 'success' as DeviceStatus } : s,
          ),
        )
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : 'Unknown error'
        setExecStates((prev) =>
          prev.map((s) =>
            s.deviceId === device.id
              ? { ...s, status: 'failed' as DeviceStatus, error: errorMsg }
              : s,
          ),
        )
      }
    }

    setIsRunning(false)
    setIsComplete(true)
    toast({ title: 'Batch execution complete' })
  }, [batchChange, isRunning, selectedDevices, tenantId])

  const handleReset = () => {
    setStep(1)
    setSelectedDeviceIds(new Set())
    setOperationType(null)
    setFormData({})
    setBatchChange(null)
    setExecStates([])
    setIsRunning(false)
    setIsComplete(false)
  }

  return (
    <div className="space-y-4">
      <StepIndicator currentStep={step} />

      {/* Step content */}
      {step === 1 && (
        <DeviceSelector
          tenantId={tenantId}
          selectedIds={selectedDeviceIds}
          onSelectionChange={setSelectedDeviceIds}
        />
      )}

      {step === 2 && (
        <ChangeDefiner
          operationType={operationType}
          onOperationTypeChange={setOperationType}
          formData={formData}
          onFormDataChange={setFormData}
        />
      )}

      {step === 3 && batchChange && (
        <ExecutionPanel
          tenantId={tenantId}
          change={batchChange}
          devices={selectedDevices}
          execStates={execStates}
          isRunning={isRunning}
          isComplete={isComplete}
          onExecute={handleExecute}
        />
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div>
          {step > 1 && !isRunning && (
            <Button variant="outline" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {isComplete && (
            <Button variant="outline" onClick={handleReset}>
              Start New Batch
            </Button>
          )}
          {step < 3 && (
            <Button onClick={handleNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
