import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, AlertTriangle, Router } from 'lucide-react'
import { tenantsApi, devicesApi } from '@/lib/api'
import type { TenantResponse, DeviceResponse } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
// Checkbox removed -- TLS is always on (port 8729)

type Step = 1 | 2 | 3 | 'complete'

const STEP_LABELS = ['Create Organization', 'Add Device', 'Verify']
const POLL_INTERVAL = 2000
const POLL_TIMEOUT = 120000

// ---- Step Indicator ----

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const stepNum = currentStep === 'complete' ? 4 : currentStep

  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, idx) => {
        const num = idx + 1
        const isCompleted = stepNum > num
        const isCurrent = stepNum === num

        return (
          <div key={label} className="flex items-center">
            {idx > 0 && (
              <div
                className={`h-0.5 w-12 sm:w-16 ${
                  isCompleted ? 'bg-success' : 'bg-elevated'
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  isCompleted
                    ? 'bg-success text-white'
                    : isCurrent
                      ? 'bg-accent text-white'
                      : 'bg-elevated text-text-muted'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  num
                )}
              </div>
              <span
                className={`text-xs whitespace-nowrap ${
                  isCurrent ? 'text-text-primary font-medium' : 'text-text-muted'
                }`}
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

// ---- Step 1: Create Tenant ----

interface Step1Props {
  onComplete: (tenant: TenantResponse) => void
}

function CreateTenantStep({ onComplete }: Step1Props) {
  const [name, setName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    try {
      const tenant = await tenantsApi.create({
        name: name.trim(),
        contact_email: contactEmail.trim() || undefined,
      })
      toast({ title: `Organization "${tenant.name}" created` })
      onComplete(tenant)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Failed to create organization'
      toast({ title: detail, variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          Create your first organization
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          Organizations group devices by client or location.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tenant-name">Organization Name *</Label>
          <Input
            id="tenant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corporation"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant-email">Contact Email</Label>
          <Input
            id="tenant-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="admin@acme.com (optional)"
          />
        </div>
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </div>
    </form>
  )
}

// ---- Step 2: Add Device ----

interface Step2Props {
  tenantId: string
  onComplete: (device: DeviceResponse) => void
  onSkip: () => void
}

function AddDeviceStep({ tenantId, onComplete, onSkip }: Step2Props) {
  const [form, setForm] = useState({
    hostname: '',
    ip_address: '',
    api_ssl_port: '8729',
    username: '',
    password: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const update =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
    }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.ip_address.trim() || !form.username.trim() || !form.password.trim()) {
      toast({ title: 'IP address, username, and password are required', variant: 'destructive' })
      return
    }

    setIsSubmitting(true)
    try {
      const device = await devicesApi.create(tenantId, {
        hostname: form.hostname.trim() || form.ip_address.trim(),
        ip_address: form.ip_address.trim(),
        api_ssl_port: parseInt(form.api_ssl_port) || 8729,
        username: form.username.trim(),
        password: form.password,
      })
      toast({ title: `Device "${device.hostname}" added` })
      onComplete(device)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Failed to add device. Check the connection details.'
      toast({ title: detail, variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          Add your first MikroTik device
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          Enter the RouterOS device connection details.
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="setup-ip">IP Address *</Label>
            <Input
              id="setup-ip"
              value={form.ip_address}
              onChange={update('ip_address')}
              placeholder="192.168.1.1"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-hostname">Display Name</Label>
            <Input
              id="setup-hostname"
              value={form.hostname}
              onChange={update('hostname')}
              placeholder="router-01 (optional)"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-port">TLS API Port</Label>
            <Input
              id="setup-port"
              value={form.api_ssl_port}
              onChange={update('api_ssl_port')}
              placeholder="8729"
              type="number"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-username">Username *</Label>
            <Input
              id="setup-username"
              value={form.username}
              onChange={update('username')}
              placeholder="admin"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-password">Password *</Label>
            <Input
              id="setup-password"
              type="password"
              value={form.password}
              onChange={update('password')}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
        </div>

      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onSkip}
          className="text-text-secondary text-sm hover:text-text-primary transition-colors"
        >
          Skip
        </button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            'Add Device'
          )}
        </Button>
      </div>
    </form>
  )
}

// ---- Step 3: Verify Connectivity ----

interface Step3Props {
  tenantId: string
  deviceId: string
  onComplete: () => void
}

function VerifyConnectivityStep({ tenantId, deviceId, onComplete }: Step3Props) {
  const [status, setStatus] = useState<'polling' | 'online' | 'timeout'>('polling')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    setStatus('polling')
    cleanup()

    const poll = async () => {
      try {
        const device = await devicesApi.get(tenantId, deviceId)
        if (device.status === 'online') {
          cleanup()
          setStatus('online')
        }
      } catch {
        // Device might not be reachable yet -- continue polling
      }
    }

    // Poll immediately then on interval
    void poll()
    intervalRef.current = setInterval(() => void poll(), POLL_INTERVAL)

    // Timeout after POLL_TIMEOUT ms
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setStatus((prev) => (prev === 'polling' ? 'timeout' : prev))
    }, POLL_TIMEOUT)
  }, [tenantId, deviceId, cleanup])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startPolling()
    return cleanup
  }, [startPolling, cleanup])

  return (
    <div className="space-y-6 text-center">
      {status === 'polling' && (
        <>
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="h-12 w-12 text-accent animate-spin" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Verifying connection...
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                This typically takes 1-2 minutes while the poller connects to your device.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onComplete}
              className="text-text-secondary text-sm hover:text-text-primary transition-colors"
            >
              Skip verification
            </button>
          </div>
        </>
      )}

      {status === 'online' && (
        <>
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-10 w-10 text-success" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Device connected successfully!
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                Your MikroTik device is online and ready to manage.
              </p>
            </div>
          </div>
          <Button onClick={onComplete} size="lg" className="mx-auto">
            Go to Dashboard
          </Button>
        </>
      )}

      {status === 'timeout' && (
        <>
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
              <AlertTriangle className="h-10 w-10 text-warning" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Device hasn't connected yet
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                It may take a few more moments for the poller to reach your device. You can
                wait longer or continue to the dashboard.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={startPolling}>
              Wait Longer
            </Button>
            <Button onClick={onComplete}>Go to Dashboard</Button>
          </div>
        </>
      )}
    </div>
  )
}

// ---- Main SetupWizard ----

export function SetupWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(1)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)

  // On mount, check if a tenant already exists (e.g. user skipped step 2 and got redirected back)
  useEffect(() => {
    let cancelled = false
    tenantsApi.list().then((tenants) => {
      // Filter out System (Internal) tenant — only real customer tenants count
      const realTenants = tenants.filter(
        (t) => t.id !== '00000000-0000-0000-0000-000000000000',
      )
      if (!cancelled && realTenants.length > 0 && !tenantId) {
        setTenantId(realTenants[0].id)
        setStep(2)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const goToDashboard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tenants'] })
    void navigate({ to: '/' })
  }, [navigate, queryClient])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo / Title */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <Router className="h-6 w-6 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">TOD - The Other Dude</h1>
            <p className="text-xs text-text-muted">First-time Setup</p>
          </div>
        </div>

        {/* Step Indicator */}
        <StepIndicator currentStep={step} />

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl shadow-lg p-8">
          {step === 1 && (
            <CreateTenantStep
              onComplete={(tenant) => {
                void queryClient.invalidateQueries({ queryKey: ['tenants'] })
                setTenantId(tenant.id)
                setStep(2)
              }}
            />
          )}

          {step === 2 && tenantId && (
            <AddDeviceStep
              tenantId={tenantId}
              onComplete={(device) => {
                setDeviceId(device.id)
                setStep(3)
              }}
              onSkip={goToDashboard}
            />
          )}

          {step === 3 && tenantId && deviceId && (
            <VerifyConnectivityStep
              tenantId={tenantId}
              deviceId={deviceId}
              onComplete={goToDashboard}
            />
          )}
        </div>
      </div>
    </div>
  )
}
