import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Copy, Loader2, AlertTriangle, Wifi } from 'lucide-react'
import { vpnApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'

interface Props {
  tenantId: string
  onSuccess: () => void
  onCancel: () => void
}

type Step = 'details' | 'commands' | 'waiting'

interface OnboardResult {
  device_id: string
  peer_id: string
  hostname: string
  assigned_ip: string
  routeros_commands: string[]
}

export function VpnOnboardingWizard({ tenantId, onSuccess, onCancel }: Props) {
  const [step, setStep] = useState<Step>('details')
  const [form, setForm] = useState({ hostname: '', username: 'admin', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [onboardResult, setOnboardResult] = useState<OnboardResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const onboardMutation = useMutation({
    mutationFn: () => vpnApi.onboard(tenantId, form),
    onSuccess: (result) => {
      setOnboardResult(result)
      setStep('commands')
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Failed to create device. Please try again.'
      setError(detail)
    },
  })

  // Poll for tunnel handshake in waiting step
  const { data: peers } = useQuery({
    queryKey: ['vpn-peers', tenantId],
    queryFn: () => vpnApi.listPeers(tenantId),
    refetchInterval: step === 'waiting' ? 3000 : false,
    enabled: step === 'waiting',
  })

  // Check if our peer has a handshake
  const peerConnected = peers?.find(
    (p) => p.id === onboardResult?.peer_id && p.last_handshake
  )

  // Timer for waiting step
  useEffect(() => {
    if (step !== 'waiting') return
    setElapsed(0)
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(interval)
  }, [step])

  // Auto-advance on connection
  useEffect(() => {
    if (peerConnected) {
      toast({ title: `${onboardResult?.hostname} connected via VPN!` })
      setTimeout(onSuccess, 1500)
    }
  }, [peerConnected, onboardResult?.hostname, onSuccess])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.hostname.trim() || !form.username.trim() || !form.password.trim()) {
      setError('All fields are required')
      return
    }
    setError(null)
    onboardMutation.mutate()
  }

  const copyCommands = useCallback(async () => {
    if (!onboardResult) return
    await navigator.clipboard.writeText(onboardResult.routeros_commands.join('\n'))
    setCopied(true)
    toast({ title: 'Commands copied to clipboard' })
    setTimeout(() => setCopied(false), 2000)
  }, [onboardResult])

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    if (error) setError(null)
  }

  // Step 1: Device Details
  if (step === 'details') {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vpn-hostname">Device Hostname *</Label>
            <Input
              id="vpn-hostname"
              value={form.hostname}
              onChange={update('hostname')}
              placeholder="router-branch-01"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vpn-username">RouterOS Username *</Label>
            <Input
              id="vpn-username"
              value={form.username}
              onChange={update('username')}
              placeholder="admin"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vpn-password">RouterOS Password *</Label>
            <Input
              id="vpn-password"
              type="password"
              value={form.password}
              onChange={update('password')}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-error flex-shrink-0" />
            <p className="text-xs text-error">{error}</p>
          </div>
        )}

        <p className="text-xs text-text-secondary">
          A VPN tunnel will be created for this device. You'll paste the generated
          WireGuard commands into the router's terminal.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} size="sm">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={onboardMutation.isPending}>
            {onboardMutation.isPending ? 'Creating...' : 'Next'}
          </Button>
        </div>
      </form>
    )
  }

  // Step 2: RouterOS Commands
  if (step === 'commands' && onboardResult) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">
              Paste these commands into {onboardResult.hostname}'s terminal
            </p>
            <Button variant="ghost" size="sm" onClick={copyCommands} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied!' : 'Copy All'}
            </Button>
          </div>
          <pre className="rounded-md bg-elevated border border-border p-3 text-xs font-mono text-text-primary overflow-x-auto whitespace-pre-wrap">
            {onboardResult.routeros_commands.join('\n')}
          </pre>
        </div>

        <div className="rounded-md bg-accent/5 border border-accent/20 px-3 py-2">
          <p className="text-xs text-text-secondary">
            <strong>VPN IP:</strong> {onboardResult.assigned_ip}
            <br />
            These commands create a WireGuard interface, add the portal as a peer,
            and assign the VPN IP address. The tunnel will connect automatically.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} size="sm">
            Close
          </Button>
          <Button size="sm" onClick={() => setStep('waiting')}>
            I've pasted the commands
          </Button>
        </div>
      </div>
    )
  }

  // Step 3: Waiting for Connection
  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-col items-center gap-3 py-4">
        {peerConnected ? (
          <>
            <div className="rounded-full bg-success/10 p-3">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-text-primary">
                {onboardResult?.hostname} connected!
              </p>
              <p className="text-xs text-text-secondary mt-1">
                VPN tunnel is active at {onboardResult?.assigned_ip}. The poller will begin monitoring shortly.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-full bg-accent/10 p-3">
              <Wifi className="h-8 w-8 text-accent animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-text-primary">
                Waiting for tunnel...
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Paste the commands into {onboardResult?.hostname}'s terminal.
                The tunnel will be detected automatically.
              </p>
              <p className="text-xs text-text-tertiary mt-2 tabular-nums">
                {elapsed}s elapsed
              </p>
            </div>
          </>
        )}
      </div>

      {elapsed >= 120 && !peerConnected && (
        <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2">
          <p className="text-xs text-warning">
            <strong>Taking longer than expected?</strong> Check that:
          </p>
          <ul className="text-xs text-warning mt-1 list-disc list-inside space-y-0.5">
            <li>The commands were pasted correctly (no errors in terminal)</li>
            <li>The router can reach the server on UDP port 51820</li>
            <li>No firewall is blocking WireGuard traffic</li>
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {!peerConnected && (
          <Button type="button" variant="ghost" onClick={onCancel} size="sm">
            Close (device saved, connect later)
          </Button>
        )}
      </div>
    </div>
  )
}
