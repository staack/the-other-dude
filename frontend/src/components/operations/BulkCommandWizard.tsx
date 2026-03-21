/**
 * BulkCommandWizard -- 3-step wizard for executing a RouterOS CLI command
 * across multiple devices sequentially.
 *
 * Step 1: Select Devices (individual, by group, or all online)
 * Step 2: Enter Command (with client-side blocklist validation)
 * Step 3: Review & Execute (sequential execution with per-device results)
 */

import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Play,
  AlertTriangle,
  Search,
  RotateCcw,
  MinusCircle,
} from 'lucide-react'
import {
  devicesApi,
  deviceGroupsApi,
  type DeviceResponse,
} from '@/lib/api'
import { configEditorApi } from '@/lib/configEditorApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { DeviceLink } from '@/components/ui/device-link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeviceExecStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

interface DeviceExecResult {
  deviceId: string
  hostname: string
  ipAddress: string
  status: DeviceExecStatus
  output?: string
  error?: string
  duration?: number
}

interface BulkCommandWizardProps {
  tenantId: string
}

type SelectionMode = 'individual' | 'by-group' | 'all-online'

// ---------------------------------------------------------------------------
// Client-side blocklist (matches backend DANGEROUS_COMMANDS subset)
// ---------------------------------------------------------------------------

const BLOCKED_COMMAND_PREFIXES = [
  '/system/reset-configuration',
  '/system/shutdown',
  '/system/reboot',
  '/user',
  '/password',
  '/certificate',
]

function checkCommandBlocked(command: string): string | null {
  const normalized = command.trim().toLowerCase()
  for (const blocked of BLOCKED_COMMAND_PREFIXES) {
    if (normalized.startsWith(blocked)) {
      return `Command matches dangerous prefix "${blocked}". This operation is blocked for safety.`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = ['Select Devices', 'Enter Command', 'Review & Execute']

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
// Main Component
// ---------------------------------------------------------------------------

export function BulkCommandWizard({ tenantId }: BulkCommandWizardProps) {
  const [step, setStep] = useState(1)
  const [selectedDevices, setSelectedDevices] = useState<DeviceResponse[]>([])
  const [command, setCommand] = useState('')
  const [results, setResults] = useState<DeviceExecResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const abortRef = useRef(false)

  // Reset wizard to step 1
  const resetWizard = useCallback(() => {
    setStep(1)
    setSelectedDevices([])
    setCommand('')
    setResults([])
    setIsExecuting(false)
    setShowConfirm(false)
    abortRef.current = false
  }, [])

  // Execute command on all selected devices sequentially
  const executeAll = useCallback(async () => {
    setShowConfirm(false)
    setIsExecuting(true)
    abortRef.current = false

    const initialResults: DeviceExecResult[] = selectedDevices.map((d) => ({
      deviceId: d.id,
      hostname: d.hostname,
      ipAddress: d.ip_address,
      status: d.status === 'online' ? 'pending' : 'skipped',
      error: d.status !== 'online' ? 'Device offline' : undefined,
    }))
    setResults([...initialResults])

    for (let i = 0; i < initialResults.length; i++) {
      if (abortRef.current) break
      if (initialResults[i].status === 'skipped') continue

      // Mark as running
      initialResults[i].status = 'running'
      setResults([...initialResults])

      const start = performance.now()
      try {
        const response = await configEditorApi.execute(
          tenantId,
          initialResults[i].deviceId,
          command,
        )
        const elapsed = Math.round(performance.now() - start)

        if (response.success) {
          initialResults[i].status = 'success'
          initialResults[i].output = response.data
            ? JSON.stringify(response.data, null, 2)
            : 'OK'
        } else {
          initialResults[i].status = 'error'
          initialResults[i].error = response.error ?? 'Unknown error'
        }
        initialResults[i].duration = elapsed
      } catch (err: unknown) {
        const elapsed = Math.round(performance.now() - start)
        initialResults[i].status = 'error'
        initialResults[i].error =
          (err as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail ??
          (err as Error)?.message ??
          'Execution failed'
        initialResults[i].duration = elapsed
      }

      setResults([...initialResults])
    }

    setIsExecuting(false)
  }, [selectedDevices, tenantId, command])

  // Computed summary
  const succeeded = results.filter((r) => r.status === 'success').length
  const failed = results.filter((r) => r.status === 'error').length
  const skipped = results.filter((r) => r.status === 'skipped').length

  const blockWarning = command ? checkCommandBlocked(command) : null

  return (
    <div className="space-y-4">
      <StepIndicator currentStep={step} />

      {/* Step 1: Select Devices */}
      {step === 1 && (
        <DeviceSelectionStep
          tenantId={tenantId}
          selectedDevices={selectedDevices}
          onSelectionChange={setSelectedDevices}
          onNext={() => setStep(2)}
        />
      )}

      {/* Step 2: Enter Command */}
      {step === 2 && (
        <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Enter RouterOS Command</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Enter a full RouterOS CLI command, e.g., /ip/address/print or
              /system/resource/print
            </p>
          </div>

          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="/ip/address/print"
            className="font-mono text-sm"
            autoFocus
          />

          {blockWarning && (
            <div className="flex items-start gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-error flex-shrink-0 mt-0.5" />
              <p className="text-xs text-error">{blockWarning}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => setStep(3)}
              disabled={!command.trim() || !!blockWarning}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Execute */}
      {step === 3 && (
        <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Review & Execute</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Verify the command and target devices before executing.
            </p>
          </div>

          {/* Command summary */}
          <div className="rounded-md bg-elevated px-3 py-2">
            <p className="text-xs text-text-muted mb-1">Command</p>
            <code className="text-sm font-mono text-text-primary">
              {command}
            </code>
          </div>

          {/* Device list (scrollable) */}
          <div>
            <p className="text-xs text-text-muted mb-1">
              {selectedDevices.length} device
              {selectedDevices.length !== 1 ? 's' : ''} selected
            </p>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border/50">
              {selectedDevices.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-border/30 last:border-0"
                >
                  <DeviceLink tenantId={tenantId} deviceId={d.id} className="font-medium">{d.hostname}</DeviceLink>
                  <span className="text-text-muted font-mono">
                    {d.ip_address}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Results table (shown after execution starts) */}
          {results.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-panel">
                    <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                      Device
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-text-muted w-24">
                      Status
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                      Output
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-text-muted w-16">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.deviceId}
                      className="border-b border-border/50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-xs">
                          <DeviceLink tenantId={tenantId} deviceId={r.deviceId}>{r.hostname}</DeviceLink>
                        </div>
                        <div className="text-[10px] text-text-muted font-mono">
                          {r.ipAddress}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2">
                        {r.status === 'success' && r.output && (
                          <pre className="text-[10px] text-text-secondary font-mono max-w-xs truncate">
                            {r.output.slice(0, 120)}
                          </pre>
                        )}
                        {r.status === 'error' && (
                          <span className="text-xs text-error">
                            {r.error}
                          </span>
                        )}
                        {r.status === 'skipped' && (
                          <span className="text-xs text-text-muted">
                            {r.error}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-text-muted">
                        {r.duration != null
                          ? `${(r.duration / 1000).toFixed(1)}s`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary banner after completion */}
          {!isExecuting && results.length > 0 && (
            <div className="flex items-center gap-3 rounded-md bg-elevated px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs">
                <CheckCircle className="h-3.5 w-3.5 text-success" />
                <span className="text-success font-medium">
                  {succeeded} succeeded
                </span>
              </div>
              {failed > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <XCircle className="h-3.5 w-3.5 text-error" />
                  <span className="text-error font-medium">
                    {failed} failed
                  </span>
                </div>
              )}
              {skipped > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <MinusCircle className="h-3.5 w-3.5 text-text-muted" />
                  <span className="text-text-muted font-medium">
                    {skipped} skipped
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {results.length === 0 ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(2)}
                  disabled={isExecuting}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowConfirm(true)}
                  disabled={isExecuting}
                >
                  <Play className="h-4 w-4" />
                  Execute
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetWizard}
                disabled={isExecuting}
              >
                <RotateCcw className="h-4 w-4" />
                New Command
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Execution</DialogTitle>
            <DialogDescription>
              Execute{' '}
              <code className="font-mono bg-elevated px-1 rounded text-xs">
                {command}
              </code>{' '}
              on {selectedDevices.length} device
              {selectedDevices.length !== 1 ? 's' : ''}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={executeAll}>
              <Play className="h-4 w-4" />
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: DeviceExecStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <div className="w-2 h-2 rounded-full bg-border" />
          Pending
        </span>
      )
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-accent">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      )
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <CheckCircle className="h-3 w-3" />
          Success
        </span>
      )
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-error">
          <XCircle className="h-3 w-3" />
          Error
        </span>
      )
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <MinusCircle className="h-3 w-3" />
          Skipped
        </span>
      )
  }
}

// ---------------------------------------------------------------------------
// Device Selection Step
// ---------------------------------------------------------------------------

function DeviceSelectionStep({
  tenantId,
  selectedDevices,
  onSelectionChange,
  onNext,
}: {
  tenantId: string
  selectedDevices: DeviceResponse[]
  onSelectionChange: (devices: DeviceResponse[]) => void
  onNext: () => void
}) {
  const [mode, setMode] = useState<SelectionMode>('individual')
  const [searchFilter, setSearchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedGroup, setSelectedGroup] = useState<string>('')

  const { data: deviceData, isLoading: devicesLoading } = useQuery({
    queryKey: ['devices', tenantId, 'bulk-cmd'],
    queryFn: () => devicesApi.list(tenantId, { page_size: 100 }),
  })

  const { data: groups } = useQuery({
    queryKey: ['device-groups', tenantId],
    queryFn: () => deviceGroupsApi.list(tenantId),
  })

  const devices = deviceData?.items ?? []
  const selectedIds = new Set(selectedDevices.map((d) => d.id))

  // Filter devices
  const filteredDevices = devices.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    if (searchFilter) {
      const q = searchFilter.toLowerCase()
      if (
        !d.hostname.toLowerCase().includes(q) &&
        !d.ip_address.toLowerCase().includes(q)
      )
        return false
    }
    return true
  })

  const toggleDevice = (device: DeviceResponse) => {
    if (selectedIds.has(device.id)) {
      onSelectionChange(selectedDevices.filter((d) => d.id !== device.id))
    } else {
      onSelectionChange([...selectedDevices, device])
    }
  }

  const selectAllOnline = () => {
    onSelectionChange(devices.filter((d) => d.status === 'online'))
  }

  const selectByGroup = (groupId: string) => {
    setSelectedGroup(groupId)
    const group = groups?.find((g) => g.id === groupId)
    if (!group) return
    // Select all devices that belong to this group
    const groupDevices = devices.filter((d) =>
      d.groups?.some((g) => g.id === groupId),
    )
    onSelectionChange(groupDevices)
  }

  if (devicesLoading) {
    return <TableSkeleton rows={5} />
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Select Target Devices</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Choose which devices to execute the command on.
        </p>
      </div>

      {/* Selection mode tabs */}
      <div className="flex gap-1 rounded-md bg-elevated p-1">
        {(
          [
            { value: 'individual', label: 'Select Individual' },
            { value: 'by-group', label: 'By Group' },
            { value: 'all-online', label: 'All Online' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setMode(opt.value)
              if (opt.value === 'all-online') selectAllOnline()
            }}
            className={cn(
              'flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              mode === opt.value
                ? 'bg-panel text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Group selector */}
      {mode === 'by-group' && groups && (
        <Select value={selectedGroup} onValueChange={selectByGroup}>
          <SelectTrigger className="w-64 h-8 text-xs">
            <SelectValue placeholder="Select a group..." />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name} ({g.device_count} devices)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Search + filter (for individual mode) */}
      {mode === 'individual' && (
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter by hostname or IP..."
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Device list */}
      {(mode === 'individual' || mode === 'by-group') && (
        <div className="rounded-md border border-border/50 overflow-hidden max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-border bg-panel">
                <th className="px-3 py-2 w-8">
                  <Checkbox
                    checked={
                      filteredDevices.length > 0 &&
                      filteredDevices.every((d) => selectedIds.has(d.id))
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        const newSet = new Set(selectedIds)
                        filteredDevices.forEach((d) => newSet.add(d.id))
                        onSelectionChange(
                          devices.filter((d) => newSet.has(d.id)),
                        )
                      } else {
                        const removeSet = new Set(
                          filteredDevices.map((d) => d.id),
                        )
                        onSelectionChange(
                          selectedDevices.filter(
                            (d) => !removeSet.has(d.id),
                          ),
                        )
                      }
                    }}
                  />
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                  Hostname
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                  IP Address
                </th>
                <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">
                  Status
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                  Model
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-border/30 hover:bg-elevated/50 cursor-pointer"
                  onClick={() => toggleDevice(d)}
                >
                  <td
                    className="px-3 py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(d.id)}
                      onCheckedChange={() => toggleDevice(d)}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-xs font-medium">
                    {d.hostname}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-text-secondary">
                    {d.ip_address}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span
                      className={cn(
                        'inline-block w-2 h-2 rounded-full',
                        d.status === 'online'
                          ? 'bg-success'
                          : 'bg-text-muted',
                      )}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-text-muted">
                    {d.model ?? ''}
                  </td>
                </tr>
              ))}
              {filteredDevices.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-text-muted"
                  >
                    No devices found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* All online summary */}
      {mode === 'all-online' && (
        <div className="rounded-md bg-elevated px-4 py-3 text-xs">
          <span className="font-medium text-text-primary">
            {selectedDevices.length}
          </span>{' '}
          <span className="text-text-muted">
            online device{selectedDevices.length !== 1 ? 's' : ''} selected
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-text-muted">
          {selectedDevices.length} device
          {selectedDevices.length !== 1 ? 's' : ''} selected
        </p>
        <Button
          size="sm"
          onClick={onNext}
          disabled={selectedDevices.length === 0}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
