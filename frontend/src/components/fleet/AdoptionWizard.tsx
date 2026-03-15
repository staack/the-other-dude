/**
 * AdoptionWizard -- 5-step device adoption wizard.
 *
 * Step 1: Enter Subnet (CIDR input, trigger scan)
 * Step 2: Scan Results (select discovered devices)
 * Step 3: Configure Credentials (shared, template, or per-device)
 * Step 4: Assign Groups & Tags
 * Step 5: Import & Verify (bulk-add, then check connectivity)
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Search,
  Wifi,
  WifiOff,
  Plus,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  devicesApi,
  deviceGroupsApi,
  deviceTagsApi,
  type SubnetScanResponse,
  type SubnetScanResult,
  type DeviceResponse,
} from '@/lib/api'
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdoptionWizardProps {
  tenantId: string
}

type CredentialMode = 'shared' | 'template' | 'per-device'

interface PerDeviceCreds {
  username: string
  password: string
}

type VerifyStatus = 'pending' | 'checking' | 'online' | 'unreachable'

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    'Enter Subnet',
    'Scan Results',
    'Credentials',
    'Groups & Tags',
    'Import & Verify',
  ]

  return (
    <div className="flex items-center justify-center gap-1.5 mb-6 flex-wrap">
      {steps.map((label, idx) => {
        const stepNum = idx + 1
        const isActive = stepNum === currentStep
        const isComplete = stepNum < currentStep

        return (
          <div key={label} className="flex items-center gap-1.5">
            {idx > 0 && (
              <div
                className={cn(
                  'w-6 h-px',
                  isComplete ? 'bg-success' : 'bg-border',
                )}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium',
                  isActive && 'bg-accent text-white',
                  isComplete && 'bg-success text-white',
                  !isActive && !isComplete && 'bg-elevated text-text-muted',
                )}
              >
                {isComplete ? <CheckCircle className="h-3.5 w-3.5" /> : stepNum}
              </div>
              <span
                className={cn(
                  'text-xs hidden lg:inline',
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

export function AdoptionWizard({ tenantId }: AdoptionWizardProps) {
  const [step, setStep] = useState(1)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Step 1 state
  const [scanResults, setScanResults] = useState<SubnetScanResponse | null>(
    null,
  )

  // Step 2 state
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set())

  // Step 3 state
  const [credMode, setCredMode] = useState<CredentialMode>('shared')
  const [sharedUsername, setSharedUsername] = useState('admin')
  const [sharedPassword, setSharedPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [port, setPort] = useState<number>(8729)
  const [perDeviceCreds, setPerDeviceCreds] = useState<
    Record<string, PerDeviceCreds>
  >({})

  // Step 4 state
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [newGroupName, setNewGroupName] = useState('')

  // Step 5 state
  const [importedDevices, setImportedDevices] = useState<DeviceResponse[]>([])
  const [failedImports, setFailedImports] = useState<
    Array<{ ip_address: string; error: string }>
  >([])
  const [verifyStatuses, setVerifyStatuses] = useState<
    Record<string, VerifyStatus>
  >({})

  // Fetch existing devices to mark already-known IPs
  const { data: existingDevices } = useQuery({
    queryKey: ['devices', tenantId, 'adoption'],
    queryFn: () => devicesApi.list(tenantId, { page_size: 100 }),
  })

  const { data: groups } = useQuery({
    queryKey: ['device-groups', tenantId],
    queryFn: () => deviceGroupsApi.list(tenantId),
  })

  const { data: tags } = useQuery({
    queryKey: ['device-tags', tenantId],
    queryFn: () => deviceTagsApi.list(tenantId),
  })

  const existingIps = new Set(
    existingDevices?.items?.map((d) => d.ip_address) ?? [],
  )

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: () =>
      deviceGroupsApi.create(tenantId, { name: newGroupName }),
    onSuccess: (newGroup) => {
      setSelectedGroupIds((prev) => [...prev, newGroup.id])
      setNewGroupName('')
      void queryClient.invalidateQueries({
        queryKey: ['device-groups', tenantId],
      })
      toast({ title: `Group "${newGroup.name}" created` })
    },
    onError: () => {
      toast({ title: 'Failed to create group', variant: 'destructive' })
    },
  })

  const selectedResults = scanResults?.discovered.filter(
    (d) => selectedIps.has(d.ip_address) && !existingIps.has(d.ip_address),
  ) ?? []

  return (
    <div className="space-y-4">
      <StepIndicator currentStep={step} />

      {/* Step 1: Enter Subnet */}
      {step === 1 && (
        <SubnetStep
          tenantId={tenantId}
          onResults={(results) => {
            setScanResults(results)
            setStep(2)
          }}
        />
      )}

      {/* Step 2: Scan Results */}
      {step === 2 && scanResults && (
        <ScanResultsStep
          results={scanResults}
          selectedIps={selectedIps}
          existingIps={existingIps}
          onSelectionChange={setSelectedIps}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {/* Step 3: Configure Credentials */}
      {step === 3 && (
        <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Configure Credentials</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Provide credentials for connecting to the selected devices.
            </p>
          </div>

          {/* Credential mode selector */}
          <div className="flex gap-1 rounded-md bg-elevated p-1">
            {(
              [
                { value: 'shared', label: 'Shared Credentials' },
                { value: 'per-device', label: 'Per-Device' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCredMode(opt.value)}
                className={cn(
                  'flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                  credMode === opt.value
                    ? 'bg-surface text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Shared credentials */}
          {credMode === 'shared' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  value={sharedUsername}
                  onChange={(e) => setSharedUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={sharedPassword}
                    onChange={(e) => setSharedPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Per-device credentials */}
          {credMode === 'per-device' && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedResults.map((d) => (
                <div
                  key={d.ip_address}
                  className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center"
                >
                  <span className="text-xs font-mono">{d.ip_address}</span>
                  <Input
                    value={perDeviceCreds[d.ip_address]?.username ?? 'admin'}
                    onChange={(e) =>
                      setPerDeviceCreds((prev) => ({
                        ...prev,
                        [d.ip_address]: {
                          ...prev[d.ip_address],
                          username: e.target.value,
                          password:
                            prev[d.ip_address]?.password ?? '',
                        },
                      }))
                    }
                    placeholder="username"
                    className="h-7 text-xs"
                    autoComplete="off"
                  />
                  <Input
                    type="password"
                    value={perDeviceCreds[d.ip_address]?.password ?? ''}
                    onChange={(e) =>
                      setPerDeviceCreds((prev) => ({
                        ...prev,
                        [d.ip_address]: {
                          ...prev[d.ip_address],
                          username:
                            prev[d.ip_address]?.username ?? 'admin',
                          password: e.target.value,
                        },
                      }))
                    }
                    placeholder="password"
                    className="h-7 text-xs"
                    autoComplete="new-password"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Port selection */}
          <div className="space-y-1.5">
            <Label>API Port</Label>
            <Select
              value={String(port)}
              onValueChange={(v) => setPort(Number(v))}
            >
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8729">8729 (TLS - default)</SelectItem>
                <SelectItem value="8728">8728 (Plain)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => setStep(4)}
              disabled={
                credMode === 'shared' &&
                (!sharedUsername || !sharedPassword)
              }
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Assign Groups & Tags */}
      {step === 4 && (
        <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Assign Groups & Tags</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Optionally assign device groups and tags to the imported devices.
            </p>
          </div>

          {/* Groups */}
          <div className="space-y-2">
            <Label>Device Groups</Label>
            <div className="flex flex-wrap gap-2">
              {groups?.map((g) => (
                <label
                  key={g.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer transition-colors',
                    selectedGroupIds.includes(g.id)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:border-accent/50',
                  )}
                >
                  <Checkbox
                    checked={selectedGroupIds.includes(g.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedGroupIds((p) => [...p, g.id])
                      } else {
                        setSelectedGroupIds((p) =>
                          p.filter((id) => id !== g.id),
                        )
                      }
                    }}
                    className="h-3 w-3"
                  />
                  {g.name}
                </label>
              ))}
            </div>
            {/* Create new group */}
            <div className="flex gap-2 items-center">
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="New group name..."
                className="h-7 text-xs max-w-xs"
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  !newGroupName.trim() || createGroupMutation.isPending
                }
                onClick={() => createGroupMutation.mutate()}
              >
                <Plus className="h-3.5 w-3.5" />
                Create
              </Button>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Device Tags</Label>
            <div className="flex flex-wrap gap-2">
              {tags?.map((t) => (
                <label
                  key={t.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer transition-colors',
                    selectedTagIds.includes(t.id)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:border-accent/50',
                  )}
                >
                  <Checkbox
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedTagIds((p) => [...p, t.id])
                      } else {
                        setSelectedTagIds((p) =>
                          p.filter((id) => id !== t.id),
                        )
                      }
                    }}
                    className="h-3 w-3"
                  />
                  {t.color && (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                  )}
                  {t.name}
                </label>
              ))}
              {tags?.length === 0 && (
                <span className="text-xs text-text-muted">
                  No tags defined yet
                </span>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(3)}>
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button size="sm" onClick={() => setStep(5)}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Import & Verify */}
      {step === 5 && (
        <ImportVerifyStep
          tenantId={tenantId}
          selectedResults={selectedResults}
          credMode={credMode}
          sharedUsername={sharedUsername}
          sharedPassword={sharedPassword}
          perDeviceCreds={perDeviceCreds}
          port={port}
          selectedGroupIds={selectedGroupIds}
          selectedTagIds={selectedTagIds}
          importedDevices={importedDevices}
          failedImports={failedImports}
          verifyStatuses={verifyStatuses}
          setImportedDevices={setImportedDevices}
          setFailedImports={setFailedImports}
          setVerifyStatuses={setVerifyStatuses}
          onBack={() => setStep(4)}
          onDone={() =>
            void navigate({
              to: '/tenants/$tenantId/devices',
              params: { tenantId },
            })
          }
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1: Subnet Entry
// ---------------------------------------------------------------------------

function SubnetStep({
  tenantId,
  onResults,
}: {
  tenantId: string
  onResults: (results: SubnetScanResponse) => void
}) {
  const [cidr, setCidr] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => devicesApi.scan(tenantId, cidr),
    onSuccess: onResults,
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Scan failed. Check the CIDR format.'
      setError(detail)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!cidr.trim()) {
      setError('CIDR is required (e.g. 192.168.1.0/24)')
      return
    }
    // Validate prefix length
    const parts = cidr.split('/')
    if (parts.length === 2) {
      const prefix = parseInt(parts[1], 10)
      if (prefix < 20) {
        setError('Maximum subnet size is /20 (4096 addresses)')
        return
      }
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Enter Subnet</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Discover MikroTik devices on a network range (max /20 -- 4096 IPs)
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1 max-w-xs space-y-1.5">
          <Label htmlFor="adopt-cidr">Network CIDR</Label>
          <Input
            id="adopt-cidr"
            value={cidr}
            onChange={(e) => {
              setCidr(e.target.value)
              if (error) setError(null)
            }}
            placeholder="192.168.1.0/24"
            autoFocus
          />
        </div>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              Scan
            </>
          )}
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
          <XCircle className="h-4 w-4 text-error flex-shrink-0" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      {mutation.isPending && (
        <div className="text-xs text-text-muted animate-pulse">
          Scanning {cidr}... This may take up to 30 seconds for larger ranges.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Scan Results Selection
// ---------------------------------------------------------------------------

function ScanResultsStep({
  results,
  selectedIps,
  existingIps,
  onSelectionChange,
  onBack,
  onNext,
}: {
  results: SubnetScanResponse
  selectedIps: Set<string>
  existingIps: Set<string>
  onSelectionChange: (ips: Set<string>) => void
  onBack: () => void
  onNext: () => void
}) {
  const newDevices = results.discovered.filter(
    (d) => !existingIps.has(d.ip_address),
  )

  const toggleIp = (ip: string) => {
    const next = new Set(selectedIps)
    if (next.has(ip)) next.delete(ip)
    else next.add(ip)
    onSelectionChange(next)
  }

  const selectAll = () => {
    onSelectionChange(new Set(newDevices.map((d) => d.ip_address)))
  }

  const deselectAll = () => onSelectionChange(new Set())

  const allNewSelected =
    newDevices.length > 0 &&
    newDevices.every((d) => selectedIps.has(d.ip_address))

  const respondedCount = results.discovered.filter(
    (d) => d.api_port_open || d.api_ssl_port_open,
  ).length

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Scan Results</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {results.total_discovered} discovered of {results.total_scanned}{' '}
            scanned -- {respondedCount} responded on RouterOS ports
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={allNewSelected ? deselectAll : selectAll}
        >
          {allNewSelected ? 'Deselect All' : 'Select All'}
        </Button>
      </div>

      <div className="rounded-md border border-border/50 overflow-hidden max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-border bg-surface">
              <th className="px-3 py-2 w-8">
                <Checkbox
                  checked={allNewSelected}
                  onCheckedChange={(c) => (c ? selectAll() : deselectAll())}
                />
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                IP Address
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                Hostname
              </th>
              <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">
                API
              </th>
              <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">
                TLS
              </th>
              <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {results.discovered.map((d) => {
              const isExisting = existingIps.has(d.ip_address)
              return (
                <tr
                  key={d.ip_address}
                  className={cn(
                    'border-b border-border/30',
                    isExisting
                      ? 'opacity-50'
                      : 'hover:bg-elevated/50 cursor-pointer',
                  )}
                  onClick={() => !isExisting && toggleIp(d.ip_address)}
                >
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={selectedIps.has(d.ip_address)}
                      onCheckedChange={() => toggleIp(d.ip_address)}
                      disabled={isExisting}
                    />
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {d.ip_address}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-text-secondary">
                    {d.hostname ?? '--'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {d.api_port_open ? (
                      <Wifi className="h-3.5 w-3.5 text-success mx-auto" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5 text-text-muted mx-auto" />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {d.api_ssl_port_open ? (
                      <Wifi className="h-3.5 w-3.5 text-success mx-auto" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5 text-text-muted mx-auto" />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {isExisting ? (
                      <span className="text-[10px] text-text-muted bg-elevated px-1.5 py-0.5 rounded">
                        Already Added
                      </span>
                    ) : (
                      <span className="text-[10px] text-success">New</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">
            {selectedIps.size} selected
          </span>
          <Button
            size="sm"
            onClick={onNext}
            disabled={selectedIps.size === 0}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 5: Import & Verify
// ---------------------------------------------------------------------------

function ImportVerifyStep({
  tenantId,
  selectedResults,
  credMode,
  sharedUsername,
  sharedPassword,
  perDeviceCreds,
  port,
  selectedGroupIds,
  selectedTagIds,
  importedDevices,
  failedImports,
  verifyStatuses,
  setImportedDevices,
  setFailedImports,
  setVerifyStatuses,
  onBack,
  onDone,
}: {
  tenantId: string
  selectedResults: SubnetScanResult[]
  credMode: CredentialMode
  sharedUsername: string
  sharedPassword: string
  perDeviceCreds: Record<string, PerDeviceCreds>
  port: number
  selectedGroupIds: string[]
  selectedTagIds: string[]
  importedDevices: DeviceResponse[]
  failedImports: Array<{ ip_address: string; error: string }>
  verifyStatuses: Record<string, VerifyStatus>
  setImportedDevices: (d: DeviceResponse[]) => void
  setFailedImports: (f: Array<{ ip_address: string; error: string }>) => void
  setVerifyStatuses: (s: Record<string, VerifyStatus>) => void
  onBack: () => void
  onDone: () => void
}) {
  const [isImporting, setIsImporting] = useState(false)
  const [isImported, setIsImported] = useState(importedDevices.length > 0)
  const queryClient = useQueryClient()

  const runImport = useCallback(async () => {
    setIsImporting(true)
    try {
      const devices = selectedResults.map((d) => {
        const perDev = perDeviceCreds[d.ip_address]
        return {
          ip_address: d.ip_address,
          hostname: d.hostname ?? d.ip_address,
          api_ssl_port: port === 8729 ? 8729 : undefined,
          api_port: port === 8728 ? 8728 : undefined,
          username:
            credMode === 'per-device' ? perDev?.username : undefined,
          password:
            credMode === 'per-device' ? perDev?.password : undefined,
        }
      })

      const result = await devicesApi.bulkAdd(tenantId, {
        devices,
        shared_username:
          credMode === 'shared' ? sharedUsername : undefined,
        shared_password:
          credMode === 'shared' ? sharedPassword : undefined,
      })

      setImportedDevices(result.added)
      setFailedImports(result.failed)

      // Assign groups and tags to imported devices
      for (const device of result.added) {
        for (const groupId of selectedGroupIds) {
          try {
            await devicesApi.addToGroup(tenantId, device.id, groupId)
          } catch {
            // Non-critical -- continue
          }
        }
        for (const tagId of selectedTagIds) {
          try {
            await devicesApi.addTag(tenantId, device.id, tagId)
          } catch {
            // Non-critical -- continue
          }
        }
      }

      // Set initial verify statuses
      const initialStatuses: Record<string, VerifyStatus> = {}
      for (const dev of result.added) {
        initialStatuses[dev.id] = 'checking'
      }
      setVerifyStatuses(initialStatuses)
      setIsImported(true)

      // Wait 5s then check connectivity
      setTimeout(async () => {
        try {
          const refreshed = await devicesApi.list(tenantId, {
            page_size: 100,
          })
          const statusMap: Record<string, VerifyStatus> = {}
          for (const dev of result.added) {
            const found = refreshed.items.find((d) => d.id === dev.id)
            statusMap[dev.id] =
              found?.status === 'online' ? 'online' : 'unreachable'
          }
          setVerifyStatuses(statusMap)
        } catch {
          const failMap: Record<string, VerifyStatus> = {}
          for (const dev of result.added) {
            failMap[dev.id] = 'unreachable'
          }
          setVerifyStatuses(failMap)
        }
      }, 5000)

      void queryClient.invalidateQueries({
        queryKey: ['devices', tenantId],
      })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })

      toast({
        title: `${result.added.length} device${result.added.length !== 1 ? 's' : ''} imported${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}`,
        variant: result.failed.length > 0 ? 'destructive' : 'default',
      })
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' })
    } finally {
      setIsImporting(false)
    }
  }, [
    selectedResults,
    credMode,
    sharedUsername,
    sharedPassword,
    perDeviceCreds,
    port,
    tenantId,
    selectedGroupIds,
    selectedTagIds,
    setImportedDevices,
    setFailedImports,
    setVerifyStatuses,
    queryClient,
  ])

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Import & Verify</h3>
        <p className="text-xs text-text-muted mt-0.5">
          {!isImported
            ? `Ready to import ${selectedResults.length} device${selectedResults.length !== 1 ? 's' : ''}`
            : 'Import complete -- verifying connectivity'}
        </p>
      </div>

      {/* Pre-import summary */}
      {!isImported && (
        <div className="rounded-md bg-elevated px-4 py-3 space-y-1">
          <p className="text-xs">
            <span className="text-text-muted">Devices:</span>{' '}
            <span className="font-medium">{selectedResults.length}</span>
          </p>
          <p className="text-xs">
            <span className="text-text-muted">Credentials:</span>{' '}
            <span className="font-medium">
              {credMode === 'shared'
                ? `Shared (${sharedUsername})`
                : 'Per-device'}
            </span>
          </p>
          <p className="text-xs">
            <span className="text-text-muted">Port:</span>{' '}
            <span className="font-medium">
              {port} ({port === 8729 ? 'TLS' : 'Plain'})
            </span>
          </p>
          {selectedGroupIds.length > 0 && (
            <p className="text-xs">
              <span className="text-text-muted">Groups:</span>{' '}
              <span className="font-medium">{selectedGroupIds.length}</span>
            </p>
          )}
          {selectedTagIds.length > 0 && (
            <p className="text-xs">
              <span className="text-text-muted">Tags:</span>{' '}
              <span className="font-medium">{selectedTagIds.length}</span>
            </p>
          )}
        </div>
      )}

      {/* Post-import results */}
      {isImported && (
        <div className="space-y-3">
          {/* Imported devices with verify status */}
          {importedDevices.length > 0 && (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                      Device
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">
                      IP
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">
                      Connectivity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {importedDevices.map((d) => {
                    const vs = verifyStatuses[d.id] ?? 'pending'
                    return (
                      <tr
                        key={d.id}
                        className="border-b border-border/30"
                      >
                        <td className="px-3 py-1.5 text-xs font-medium">
                          {d.hostname}
                        </td>
                        <td className="px-3 py-1.5 text-xs font-mono text-text-secondary">
                          {d.ip_address}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {vs === 'checking' && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent mx-auto" />
                          )}
                          {vs === 'online' && (
                            <CheckCircle className="h-3.5 w-3.5 text-success mx-auto" />
                          )}
                          {vs === 'unreachable' && (
                            <XCircle className="h-3.5 w-3.5 text-error mx-auto" />
                          )}
                          {vs === 'pending' && (
                            <div className="w-2 h-2 rounded-full bg-border mx-auto" />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Failed imports */}
          {failedImports.length > 0 && (
            <div className="rounded-md bg-error/10 border border-error/50 p-3 space-y-1">
              <p className="text-xs font-medium text-error">
                {failedImports.length} device
                {failedImports.length !== 1 ? 's' : ''} failed to import
              </p>
              {failedImports.map((f) => (
                <p key={f.ip_address} className="text-[10px] text-error/80">
                  {f.ip_address}: {f.error}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        {!isImported ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={isImporting}
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              size="sm"
              onClick={runImport}
              disabled={isImporting}
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import'
              )}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  )
}
