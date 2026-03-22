import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, List } from 'lucide-react'
import {
  devicesApi,
  vpnApi,
  credentialProfilesApi,
  snmpProfilesApi,
  type CredentialProfileResponse,
  type SNMPProfileResponse,
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
  const [snmpVersion, setSnmpVersion] = useState<'v2c' | 'v3'>('v2c')
  const [showSnmpBulk, setShowSnmpBulk] = useState(false)
  const [snmpForm, setSnmpForm] = useState({
    ip_address: '',
    hostname: '',
    snmp_port: '161',
    credential_profile_id: '',
    snmp_profile_id: '',
  })

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

  // SNMP credential profiles (filtered by version)
  const snmpCredType = snmpVersion === 'v2c' ? 'snmp_v2c' : 'snmp_v3'
  const { data: snmpCredProfiles } = useQuery({
    queryKey: ['credential-profiles', tenantId, snmpCredType],
    queryFn: () => credentialProfilesApi.list(tenantId, snmpCredType),
    enabled: open && !!tenantId,
  })

  // SNMP device profiles
  const { data: snmpDeviceProfiles } = useQuery({
    queryKey: ['snmp-profiles', tenantId],
    queryFn: () => snmpProfilesApi.list(tenantId),
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

  // SNMP single-add mutation
  const snmpMutation = useMutation({
    mutationFn: () =>
      devicesApi.create(tenantId, {
        hostname: snmpForm.hostname || snmpForm.ip_address,
        ip_address: snmpForm.ip_address,
        device_type: 'snmp',
        snmp_port: parseInt(snmpForm.snmp_port) || 161,
        snmp_version: snmpVersion,
        credential_profile_id: snmpForm.credential_profile_id || undefined,
        snmp_profile_id: snmpForm.snmp_profile_id || undefined,
      }),
    onSuccess: (device) => {
      setConnectionStatus('success')
      void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: `SNMP device "${device.hostname}" added successfully` })
      setTimeout(() => handleClose(), 1000)
    },
    onError: (err: unknown) => {
      setConnectionStatus('error')
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to add SNMP device. Check IP and credentials.'
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
    setSnmpForm({
      ip_address: '',
      hostname: '',
      snmp_port: '161',
      credential_profile_id: '',
      snmp_profile_id: '',
    })
    setRosProfileId('')
    setUseProfile(false)
    setShowBulk(false)
    setShowSnmpBulk(false)
    setSnmpVersion('v2c')
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
    if (!snmpForm.ip_address.trim()) {
      setError('IP address is required')
      return
    }
    if (!snmpForm.credential_profile_id) {
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

  const updateSnmp =
    (field: keyof typeof snmpForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setSnmpForm((f) => ({ ...f, [field]: e.target.value }))
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

  // Helper to get profile list as array
  const rosProfileList: CredentialProfileResponse[] =
    rosProfiles?.profiles ?? []
  const snmpCredProfileList: CredentialProfileResponse[] =
    snmpCredProfiles?.profiles ?? []
  const snmpDeviceProfileList: SNMPProfileResponse[] = Array.isArray(snmpDeviceProfiles)
    ? snmpDeviceProfiles
    : snmpDeviceProfiles?.profiles ?? []

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
  ) : (
    <form onSubmit={handleSnmpSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>SNMP Version</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={snmpVersion === 'v2c' ? 'default' : 'outline'}
              onClick={() => {
                setSnmpVersion('v2c')
                setSnmpForm((f) => ({ ...f, credential_profile_id: '' }))
              }}
              className="flex-1"
            >
              v2c
            </Button>
            <Button
              type="button"
              size="sm"
              variant={snmpVersion === 'v3' ? 'default' : 'outline'}
              onClick={() => {
                setSnmpVersion('v3')
                setSnmpForm((f) => ({ ...f, credential_profile_id: '' }))
              }}
              className="flex-1"
            >
              v3
            </Button>
          </div>
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label>Credential Profile *</Label>
          <Select
            value={snmpForm.credential_profile_id}
            onValueChange={(v) =>
              setSnmpForm((f) => ({ ...f, credential_profile_id: v }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select SNMP credential profile..." />
            </SelectTrigger>
            <SelectContent>
              {snmpCredProfileList.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="snmp-ip">IP Address *</Label>
          <Input
            id="snmp-ip"
            value={snmpForm.ip_address}
            onChange={updateSnmp('ip_address')}
            placeholder="192.168.1.1"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="snmp-port">SNMP Port</Label>
          <Input
            id="snmp-port"
            value={snmpForm.snmp_port}
            onChange={updateSnmp('snmp_port')}
            placeholder="161"
            type="number"
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label>Device Profile</Label>
          <Select
            value={snmpForm.snmp_profile_id}
            onValueChange={(v) =>
              setSnmpForm((f) => ({ ...f, snmp_profile_id: v }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Auto-detect (optional)" />
            </SelectTrigger>
            <SelectContent>
              {snmpDeviceProfileList.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="snmp-hostname">Display Name</Label>
          <Input
            id="snmp-hostname"
            value={snmpForm.hostname}
            onChange={updateSnmp('hostname')}
            placeholder="switch-01 (optional)"
          />
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
          <Button type="submit" size="sm" disabled={snmpMutation.isPending}>
            {snmpMutation.isPending ? 'Adding...' : 'Add Device'}
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
