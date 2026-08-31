/**
 * AdoptionWizard -- 5-step device adoption wizard.
 *
 * Step 1: Enter Subnet (CIDR input, trigger scan)
 * Step 2: Scan Results (select discovered devices)
 * Step 3: Configure Credentials (shared or per-device)
 * Step 4: Assign Groups & Tags
 * Step 5: Import & Verify (bulk-add, then check connectivity)
 */

import { useState, useCallback, useEffect, useRef } from 'react'
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
import {
  pollVerifyStatuses,
  probeVerifyStatuses,
  resultFromProbe,
  tlsDowngradeCost,
  VERIFY_TIMEOUT_MS,
  type VerifyResult,
} from './adoptionVerify'
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

type CredentialMode = 'shared' | 'per-device'

interface PerDeviceCreds {
  username: string
  password: string
}

/** RouterOS API ports. Only tls_mode='plain' ever connects on the plain one. */
const PLAIN_API_PORT = 8728
const TLS_API_PORT = 8729

/** Group/tag assignment endpoints allow 20/minute; 3s keeps us under it. */
const ASSIGNMENT_SPACING_MS = 3_000

type ImportPhase = 'idle' | 'importing' | 'assigning' | 'verifying'

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
                  'text-xs',
                  // Keep the current step named at every width; only the
                  // others collapse to bare numbers on narrow screens.
                  isActive
                    ? 'inline text-text-primary font-medium'
                    : 'hidden lg:inline text-text-muted',
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
  const [port, setPort] = useState<number>(TLS_API_PORT)
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
    Record<string, VerifyResult>
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
        <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
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
                    ? 'bg-panel text-text-primary shadow-sm'
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
                <SelectItem value={String(TLS_API_PORT)}>
                  {TLS_API_PORT} (TLS - default)
                </SelectItem>
                <SelectItem value={String(PLAIN_API_PORT)}>
                  {PLAIN_API_PORT} (Plain)
                </SelectItem>
              </SelectContent>
            </Select>
            {port === PLAIN_API_PORT && (
              <p className="text-[10px] text-warning">
                Plain mode sends the API password unencrypted. Only use it for
                devices that cannot serve the TLS API on {TLS_API_PORT}.
              </p>
            )}
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
        <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">
              Assign Groups &amp; Tags{' '}
              <span className="font-normal text-text-muted">(optional)</span>
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {(groups?.length ?? 0) === 0 && (tags?.length ?? 0) === 0
                ? 'This tenant has no groups or tags yet. You can skip this step and organise devices later, or create a group below.'
                : 'Group and tag the devices you are importing, or skip and do it later.'}
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
              {groups?.length === 0 && (
                <span className="text-xs text-text-muted">
                  No groups defined yet
                </span>
              )}
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
              {selectedGroupIds.length === 0 && selectedTagIds.length === 0
                ? 'Skip'
                : 'Next'}
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
      const res = (
        err as { response?: { status?: number; data?: { detail?: string } } }
      )?.response
      // A 429 is not a bad CIDR. Saying so sent people off editing a subnet
      // that was already correct.
      if (res?.status === 429) {
        setError(
          'Too many scans. This endpoint allows 5 per minute -- wait a moment and try again.',
        )
        return
      }
      setError(res?.data?.detail ?? 'Scan failed. Check the CIDR format.')
    },
  })

  /** Rough wall-clock estimate: 2s connect timeout, 50 hosts in flight. */
  const estimatedSeconds = (() => {
    const prefix = parseInt(cidr.split('/')[1] ?? '', 10)
    if (!Number.isFinite(prefix) || prefix < 20 || prefix > 32) return null
    const hosts = Math.max(1, 2 ** (32 - prefix) - 2)
    return Math.max(5, Math.ceil((hosts / 50) * 2))
  })()

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
    <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
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
        <div className="space-y-1.5">
          <div className="text-xs text-text-muted animate-pulse">
            Scanning {cidr}...
            {estimatedSeconds !== null &&
              ` This range can take around ${estimatedSeconds >= 60 ? `${Math.ceil(estimatedSeconds / 60)} minute${estimatedSeconds >= 120 ? 's' : ''}` : `${estimatedSeconds} seconds`}.`}
          </div>
          {/* No server-side progress is reported, so this is a running
              indicator, not a percentage -- do not imply otherwise. */}
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-elevated">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
          </div>
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
    <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
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
            <tr className="border-b border-border bg-panel">
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
  verifyStatuses: Record<string, VerifyResult>
  setImportedDevices: (d: DeviceResponse[]) => void
  setFailedImports: (f: Array<{ ip_address: string; error: string }>) => void
  setVerifyStatuses: (s: Record<string, VerifyResult>) => void
  onBack: () => void
  onDone: () => void
}) {
  const [isImporting, setIsImporting] = useState(false)
  const [isImported, setIsImported] = useState(importedDevices.length > 0)
  const [importPhase, setImportPhase] = useState<ImportPhase>('idle')
  const [assignmentFailures, setAssignmentFailures] = useState(0)
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const queryClient = useQueryClient()

  const stillWaiting = importedDevices.some(
    (d) => (verifyStatuses[d.id]?.status ?? 'pending') === 'waiting',
  )
  const anyTimedOut = importedDevices.some(
    (d) => verifyStatuses[d.id]?.status === 'timeout',
  )

  // Lets the verify poll stop if the user leaves before it finishes.
  const verifySignal = useRef({ cancelled: false })
  // Probe and poll both write results; this keeps them from clobbering
  // each other when the poll resolves only part of the batch.
  const verifyResults = useRef<Record<string, VerifyResult>>({})
  useEffect(() => {
    const signal = verifySignal.current
    return () => {
      signal.cancelled = true
    }
  }, [])

  /**
   * Ask the device directly, and fall back to watching its status.
   *
   * The live probe gives an immediate, classified answer, but it costs one
   * call per device against a 30/min limit and only exists on newer backends.
   * So: probe what we can, then let the poll resolve whatever is left --
   * a large batch or an older API degrades instead of failing.
   */
  const runVerification = useCallback(
    async (deviceIds: string[]) => {
      const merge = (next: Record<string, VerifyResult>) =>
        setVerifyStatuses({ ...verifyResults.current, ...next })

      const { results, unresolved } = await probeVerifyStatuses({
        deviceIds,
        probe: (deviceId) => devicesApi.testConnection(tenantId, deviceId),
        onUpdate: merge,
        signal: verifySignal.current,
      })
      verifyResults.current = { ...verifyResults.current, ...results }

      if (unresolved.length === 0 || verifySignal.current.cancelled) return

      await pollVerifyStatuses({
        deviceIds: unresolved,
        fetchStatuses: async () => {
          const refreshed = await devicesApi.list(tenantId, { page_size: 100 })
          return Object.fromEntries(
            refreshed.items.map((d) => [d.id, d.status]),
          )
        },
        onUpdate: (statuses) => {
          const asResults: Record<string, VerifyResult> = {}
          for (const [id, status] of Object.entries(statuses)) {
            asResults[id] = { status }
          }
          verifyResults.current = { ...verifyResults.current, ...asResults }
          merge(asResults)
        },
        signal: verifySignal.current,
      })
    },
    [tenantId, setVerifyStatuses],
  )

  /**
   * Apply the mode the probe verified, then re-test once.
   *
   * Only offered when the probe confirmed the mode works, and only on an
   * explicit click. Deliberately does not loop: if the retry still fails we
   * show that result and stop, rather than bouncing the user round again.
   */
  const retryWithSuggestedMode = useCallback(
    async (deviceId: string, mode: string) => {
      setRetrying((p) => ({ ...p, [deviceId]: true }))
      try {
        await devicesApi.update(tenantId, deviceId, { tls_mode: mode })
        const probe = await devicesApi.testConnection(tenantId, deviceId)
        const next = resultFromProbe(probe)
        // Drop the suggestion either way so the action cannot repeat.
        verifyResults.current = {
          ...verifyResults.current,
          [deviceId]: { ...next, suggestedTlsMode: null },
        }
        setVerifyStatuses({ ...verifyResults.current })
        void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      } catch {
        const prev = verifyResults.current[deviceId]
        verifyResults.current = {
          ...verifyResults.current,
          [deviceId]: {
            ...prev,
            status: prev?.status ?? 'uncheckable',
            message: `Could not switch this device to ${mode}. It is still adopted; change the TLS mode on the device page.`,
            suggestedTlsMode: null,
          },
        }
        setVerifyStatuses({ ...verifyResults.current })
      } finally {
        setRetrying((p) => ({ ...p, [deviceId]: false }))
      }
    },
    [tenantId, setVerifyStatuses, queryClient],
  )

  const runImport = useCallback(async () => {
    setIsImporting(true)
    setImportPhase('importing')
    try {
      const devices = selectedResults.map((d) => {
        const perDev = perDeviceCreds[d.ip_address]
        return {
          ip_address: d.ip_address,
          hostname: d.hostname ?? d.ip_address,
          // Always send both ports. Omitting one used to drop it from the JSON
          // and let the backend default silently put it back.
          api_port: PLAIN_API_PORT,
          api_ssl_port: TLS_API_PORT,
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
        // The port choice only takes effect through tls_mode: "auto" reaches
        // the device over TLS on api_ssl_port and never falls back to plain.
        tls_mode: port === PLAIN_API_PORT ? 'plain' : 'auto',
      })

      setImportedDevices(result.added)
      setFailedImports(result.failed)

      // Assign groups and tags. Both endpoints are limited to 20/minute and
      // this is one call per device per group/tag, so pace the calls and
      // report what did not stick -- silently swallowing 429s used to make
      // assignments vanish with no indication.
      const assignments: Array<() => Promise<unknown>> = []
      for (const device of result.added) {
        for (const groupId of selectedGroupIds) {
          assignments.push(() =>
            devicesApi.addToGroup(tenantId, device.id, groupId),
          )
        }
        for (const tagId of selectedTagIds) {
          assignments.push(() => devicesApi.addTag(tenantId, device.id, tagId))
        }
      }

      if (assignments.length > 0) {
        setImportPhase('assigning')
        let failedAssignments = 0
        for (let i = 0; i < assignments.length; i++) {
          try {
            await assignments[i]()
          } catch {
            failedAssignments++
          }
          if (i < assignments.length - 1) {
            await new Promise((r) => setTimeout(r, ASSIGNMENT_SPACING_MS))
          }
        }
        setAssignmentFailures(failedAssignments)
      }

      setIsImported(true)
      setImportPhase('verifying')

      void runVerification(result.added.map((d) => d.id))

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
      setImportPhase('idle')
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
    runVerification,
    queryClient,
  ])

  return (
    <div className="rounded-lg border border-border bg-panel p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Import & Verify</h3>
        <p className="text-xs text-text-muted mt-0.5">
          {!isImported
            ? `Ready to import ${selectedResults.length} device${selectedResults.length !== 1 ? 's' : ''}`
            : stillWaiting
              ? 'Import complete -- checking connectivity'
              : 'Import complete'}
        </p>
      </div>

      {isImporting && (
        <p className="text-[10px] text-text-muted">
          {importPhase === 'assigning'
            ? 'Group and tag assignment is paced to stay within the API rate limit, so this takes a few seconds per assignment.'
            : 'Each device is contacted in turn, so this takes longer with more devices.'}
        </p>
      )}

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
              {port} ({port === PLAIN_API_PORT ? 'Plain' : 'TLS'})
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
                  <tr className="border-b border-border bg-panel">
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
                    const v = verifyStatuses[d.id] ?? { status: 'pending' }
                    const vs = v.status
                    const suggested = v.suggestedTlsMode
                    return (
                      <tr
                        key={d.id}
                        className="border-b border-border/30 align-top"
                      >
                        <td className="px-3 py-2 text-xs font-medium">
                          {d.hostname}
                          {v.identity && v.identity !== d.hostname && (
                            <span className="block text-[10px] font-normal text-text-muted">
                              reported as {v.identity}
                              {v.version ? ` -- RouterOS ${v.version}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-text-secondary">
                          {d.ip_address}
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              {vs === 'waiting' && (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                                  <span className="text-[10px] text-text-muted">
                                    Checking...
                                  </span>
                                </>
                              )}
                              {vs === 'online' && (
                                <>
                                  <Wifi className="h-3.5 w-3.5 text-success" />
                                  <span className="text-[10px] text-success">
                                    Online
                                  </span>
                                </>
                              )}
                              {vs === 'unreachable' && (
                                <>
                                  <WifiOff className="h-3.5 w-3.5 text-error" />
                                  <span className="text-[10px] text-error">
                                    Unreachable
                                  </span>
                                </>
                              )}
                              {vs === 'timeout' && (
                                <>
                                  <div className="w-2 h-2 rounded-full bg-warning" />
                                  <span className="text-[10px] text-text-muted">
                                    Not polled yet
                                  </span>
                                </>
                              )}
                              {vs === 'uncheckable' && (
                                <>
                                  <div className="w-2 h-2 rounded-full bg-warning" />
                                  <span className="text-[10px] text-text-muted">
                                    Could not check
                                  </span>
                                </>
                              )}
                              {vs === 'pending' && (
                                <div className="w-2 h-2 rounded-full bg-border" />
                              )}
                            </div>

                            {v.message && vs !== 'online' && (
                              <p className="text-[10px] text-text-secondary">
                                {v.message}
                              </p>
                            )}

                            {v.detail && vs !== 'online' && (
                              <details className="text-[10px] text-text-muted">
                                <summary className="cursor-pointer hover:text-text-secondary">
                                  Technical detail
                                </summary>
                                <span className="font-mono break-all">
                                  {v.detail}
                                </span>
                              </details>
                            )}

                            {suggested && (
                              <div className="space-y-1.5 rounded-md border border-warning/50 bg-warning/10 p-2">
                                <p className="text-[10px] font-medium text-text-secondary">
                                  The probe confirmed this device answers on{' '}
                                  <span className="font-mono">{suggested}</span>
                                  {' '}-- but that is a fallback, not a fix.
                                </p>
                                {tlsDowngradeCost(suggested) && (
                                  <p className="text-[10px] text-warning">
                                    {tlsDowngradeCost(suggested)}
                                  </p>
                                )}
                                <p className="text-[10px] text-text-muted">
                                  Prefer the remedy above where you can. This
                                  changes only this device's TLS mode, from{' '}
                                  <span className="font-mono">
                                    {d.tls_mode}
                                  </span>{' '}
                                  to{' '}
                                  <span className="font-mono">{suggested}</span>
                                  , then re-tests once.
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={retrying[d.id]}
                                  onClick={() =>
                                    void retryWithSuggestedMode(
                                      d.id,
                                      suggested,
                                    )
                                  }
                                >
                                  {retrying[d.id] ? (
                                    <>
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Applying...
                                    </>
                                  ) : tlsDowngradeCost(suggested) ? (
                                    `Switch to ${suggested} anyway and re-test`
                                  ) : (
                                    `Switch to ${suggested} and re-test`
                                  )}
                                </Button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {stillWaiting && (
            <p className="text-[10px] text-text-muted">
              Devices are adopted and saved. Each one is contacted in turn; any
              that cannot be checked directly fall back to the poller's own
              schedule, which can take up to{' '}
              {Math.round(VERIFY_TIMEOUT_MS / 1000)}s. You can leave this page
              at any time.
            </p>
          )}

          {anyTimedOut && (
            <div className="rounded-md bg-warning/10 border border-warning/50 p-3">
              <p className="text-xs text-text-secondary">
                The poller has not reported on every device yet. They are
                adopted and saved -- this is not a failure. Their status will
                appear on the devices page once the next poll runs.
              </p>
            </div>
          )}

          {assignmentFailures > 0 && (
            <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
              <p className="text-xs text-text-secondary">
                {assignmentFailures} group/tag assignment
                {assignmentFailures !== 1 ? 's' : ''} did not apply. The devices
                are adopted; you can set groups and tags from the devices page.
              </p>
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
                  {f.ip_address}:{' '}
                  {f.error?.trim() ||
                    'Import failed with no reason given -- check the API logs.'}
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
                  {importPhase === 'assigning'
                    ? 'Assigning groups & tags...'
                    : `Importing ${selectedResults.length} device${selectedResults.length !== 1 ? 's' : ''}...`}
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
