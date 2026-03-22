import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, List, Loader2, Search } from 'lucide-react'
import {
  devicesApi,
  vpnApi,
  credentialProfilesApi,
  type CredentialProfileResponse,
} from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { VpnOnboardingWizard } from '@/components/vpn/VpnOnboardingWizard'
import { BulkAddForm } from '@/components/fleet/BulkAddForm'

interface Props {
  tenantId: string
  open: boolean
  onClose: () => void
}

type ConnectionStatus = 'idle' | 'success' | 'error'

export function AddDeviceForm({ tenantId, open, onClose }: Props) {
  const queryClient = useQueryClient()

  // RouterOS state
  const [useProfile, setUseProfile] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [rosProfileId, setRosProfileId] = useState('')
  const [form, setForm] = useState({
    hostname: '',
    ip_address: '',
    api_port: '8728',
    api_ssl_port: '8729',
    username: '',
    password: '',
  })

  // SNMP state
  const [showSnmpBulk, setShowSnmpBulk] = useState(false)
  const [snmpIp, setSnmpIp] = useState('')
  const [snmpCredProfileId, setSnmpCredProfileId] = useState('')
  // Shared state
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')

  // Check if VPN is enabled for this tenant
  const { data: vpnConfig } = useQuery({
    queryKey: ['vpn-config', tenantId],
    queryFn: () => vpnApi.getConfig(tenantId),
    enabled: open && !!tenantId,
  })

  const vpnEnabled = vpnConfig?.is_enabled ?? false

  // RouterOS credential profiles
  const { data: rosProfiles } = useQuery({
    queryKey: ['credential-profiles', tenantId, 'routeros'],
    queryFn: () => credentialProfilesApi.list(tenantId, 'routeros'),
    enabled: open && !!tenantId,
  })

  // SNMP credential profiles (all SNMP types — v2c and v3)
  const { data: snmpCredProfiles } = useQuery({
    queryKey: ['credential-profiles', tenantId, 'snmp'],
    queryFn: () => credentialProfilesApi.list(tenantId),
    enabled: open && !!tenantId,
  })

  // RouterOS single-add mutation
  const rosMutation = useMutation({
    mutationFn: () => {
      if (useProfile) {
        return devicesApi.create(tenantId, {
          hostname: form.hostname || form.ip_address,
          ip_address: form.ip_address,
          device_type: 'routeros',
          credential_profile_id: rosProfileId,
          api_port: parseInt(form.api_port) || 8728,
          api_ssl_port: parseInt(form.api_ssl_port) || 8729,
        })
      }
      return devicesApi.create(tenantId, {
        hostname: form.hostname || form.ip_address,
        ip_address: form.ip_address,
        device_type: 'routeros',
        api_port: parseInt(form.api_port) || 8728,
        api_ssl_port: parseInt(form.api_ssl_port) || 8729,
        username: form.username,
        password: form.password,
      })
    },
    onSuccess: (device) => {
      setConnectionStatus('success')
      void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: `Device "${device.hostname}" added successfully` })
      setTimeout(() => handleClose(), 1000)
    },
    onError: (err: unknown) => {
      setConnectionStatus('error')
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Connection failed. Check the IP address, port, and credentials.'
      setError(detail)
    },
  })

  // SNMP discover-and-add mutation: tests connectivity then creates the device
  const snmpMutation = useMutation({
    mutationFn: async () => {
      const selectedProfile = snmpCredProfileList.find((p) => p.id === snmpCredProfileId)
      if (!selectedProfile) throw new Error('Select a credential profile')

      const snmpVersion = selectedProfile.credential_type === 'snmp_v3' ? 'v3' : 'v2c'

      // Discover the device using a test against a dummy profile
      // We use the snmpProfilesApi.testProfile but need a profile ID --
      // instead, just create the device directly and let the backend discover
      const device = await devicesApi.create(tenantId, {
        hostname: snmpIp,
        ip_address: snmpIp,
        device_type: 'snmp',
        snmp_version: snmpVersion,
        credential_profile_id: snmpCredProfileId,
      })
      return device
    },
    onSuccess: (device) => {
      setConnectionStatus('success')
      void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: `Device "${device.hostname}" discovered and added` })
      setTimeout(() => handleClose(), 1000)
    },
    onError: (err: unknown) => {
      setConnectionStatus('error')
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Discovery failed. Check the IP address and credential profile.'
      setError(detail)
    },
  })

  const handleClose = () => {
    setForm({
      hostname: '',
      ip_address: '',
      api_port: '8728',
      api_ssl_port: '8729',
      username: '',
      password: '',
    })
    setSnmpIp('')
    setSnmpCredProfileId('')
    setSnmpDiscoverResult(null)
    setRosProfileId('')
    setUseProfile(false)
    setShowBulk(false)
    setShowSnmpBulk(false)
    setError(null)
    setConnectionStatus('idle')
    onClose()
  }

  const handleVpnSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
    void queryClient.invalidateQueries({ queryKey: ['vpn-peers', tenantId] })
    handleClose()
  }

  const handleRosSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.ip_address.trim()) {
      setError('IP address is required')
      return
    }
    if (useProfile && !rosProfileId) {
      setError('Select a credential profile')
      return
    }
    if (!useProfile && (!form.username.trim() || !form.password.trim())) {
      setError('Username and password are required')
      return
    }
    setError(null)
    setConnectionStatus('idle')
    rosMutation.mutate()
  }

  const handleSnmpSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!snmpIp.trim()) {
      setError('IP address is required')
      return
    }
    if (!snmpCredProfileId) {
      setError('Select a credential profile')
      return
    }
    setError(null)
    setConnectionStatus('idle')
    snmpMutation.mutate()
  }

  const updateRos =
    (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      if (error) setError(null)
      setConnectionStatus('idle')
    }

  const statusBanner = (
    <>
      {connectionStatus === 'success' && (
        <div className="flex items-center gap-2 rounded-md bg-success/10 border border-success/50 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
          <p className="text-xs text-success">Device added successfully</p>
        </div>
      )}
      {connectionStatus === 'error' && error && (
        <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
          <XCircle className="h-4 w-4 text-error flex-shrink-0" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}
    </>
  )

  // Helper to get profile list as array (list() already unwraps the wrapper)
  const rosProfileList: CredentialProfileResponse[] =
    Array.isArray(rosProfiles) ? rosProfiles : (rosProfiles?.profiles ?? [])
  const snmpCredProfileList: CredentialProfileResponse[] =
    (Array.isArray(snmpCredProfiles) ? snmpCredProfiles : (snmpCredProfiles?.profiles ?? [])).filter(
      (p) => p.credential_type === 'snmp_v2c' || p.credential_type === 'snmp_v3',
    )

  // ─── RouterOS Tab ───────────────────────────────────────────────────────────

  const routerosTab = showBulk ? (
    <BulkAddForm
      tenantId={tenantId}
      deviceType="routeros"
      onClose={handleClose}
      onBack={() => setShowBulk(false)}
    />
  ) : (
    <form onSubmit={handleRosSubmit} className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setUseProfile(!useProfile)}
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          {useProfile ? 'Enter credentials manually' : 'Use credential profile'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {useProfile && (
          <div className="col-span-2 space-y-1.5">
            <Label>Credential Profile *</Label>
            <Select value={rosProfileId} onValueChange={setRosProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Select profile..." />
              </SelectTrigger>
              <SelectContent>
                {rosProfileList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="ros-ip">IP Address *</Label>
          <Input
            id="ros-ip"
            value={form.ip_address}
            onChange={updateRos('ip_address')}
            placeholder="192.168.1.1"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ros-hostname">Display Name</Label>
          <Input
            id="ros-hostname"
            value={form.hostname}
            onChange={updateRos('hostname')}
            placeholder="router-01 (optional)"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ros-api-port">API Port</Label>
          <Input
            id="ros-api-port"
            value={form.api_port}
            onChange={updateRos('api_port')}
            placeholder="8728"
            type="number"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ros-ssl-port">TLS API Port</Label>
          <Input
            id="ros-ssl-port"
            value={form.api_ssl_port}
            onChange={updateRos('api_ssl_port')}
            placeholder="8729"
            type="number"
          />
        </div>

        {!useProfile && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ros-username">Username *</Label>
              <Input
                id="ros-username"
                value={form.username}
                onChange={updateRos('username')}
                placeholder="admin"
                autoComplete="off"
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ros-password">Password *</Label>
              <Input
                id="ros-password"
                type="password"
                value={form.password}
                onChange={updateRos('password')}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          </>
        )}
      </div>

      {statusBanner}

      <DialogFooter className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowBulk(true)}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <List className="h-3.5 w-3.5" />
          Add Multiple
        </button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} size="sm">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={rosMutation.isPending}>
            {rosMutation.isPending ? 'Connecting...' : 'Add Device'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )

  // ─── SNMP Tab ─────────────────────────────────────────────────────────────

  const snmpTab = showSnmpBulk ? (
    <BulkAddForm
      tenantId={tenantId}
      deviceType="snmp"
      onClose={handleClose}
      onBack={() => setShowSnmpBulk(false)}
    />
  ) : snmpCredProfileList.length === 0 ? (
    <div className="py-6 text-center space-y-3">
      <p className="text-sm text-text-muted">
        No SNMP credential profiles found.
      </p>
      <p className="text-xs text-text-muted">
        Create an SNMP credential profile in{' '}
        <span className="text-accent">Settings &gt; Credential Profiles</span>{' '}
        before adding SNMP devices.
      </p>
    </div>
  ) : (
    <form onSubmit={handleSnmpSubmit} className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="snmp-ip">IP Address *</Label>
          <Input
            id="snmp-ip"
            value={snmpIp}
            onChange={(e) => {
              setSnmpIp(e.target.value)
              if (error) setError(null)
              setConnectionStatus('idle')
              setSnmpDiscoverResult(null)
            }}
            placeholder="192.168.1.1"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label>Credential Profile *</Label>
          <Select
            value={snmpCredProfileId}
            onValueChange={(v) => {
              setSnmpCredProfileId(v)
              if (error) setError(null)
              setConnectionStatus('idle')
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select SNMP credential profile..." />
            </SelectTrigger>
            <SelectContent>
              {snmpCredProfileList.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{' '}
                  <span className="text-text-muted">
                    ({p.credential_type === 'snmp_v3' ? 'v3' : 'v2c'})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {statusBanner}

      <DialogFooter className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowSnmpBulk(true)}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <List className="h-3.5 w-3.5" />
          Add Multiple
        </button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} size="sm">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={snmpMutation.isPending || !snmpIp.trim() || !snmpCredProfileId}>
            {snmpMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Discovering...
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                Discover &amp; Add
              </>
            )}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Device</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="routeros" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="routeros" className="flex-1">
              RouterOS
            </TabsTrigger>
            <TabsTrigger value="snmp" className="flex-1">
              SNMP
            </TabsTrigger>
            {vpnEnabled && (
              <TabsTrigger value="vpn" className="flex-1">
                VPN
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="routeros" className="mt-4">
            {routerosTab}
          </TabsContent>
          <TabsContent value="snmp" className="mt-4">
            {snmpTab}
          </TabsContent>
          {vpnEnabled && (
            <TabsContent value="vpn" className="mt-4">
              <VpnOnboardingWizard
                tenantId={tenantId}
                onSuccess={handleVpnSuccess}
                onCancel={handleClose}
              />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
