import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { devicesApi, vpnApi } from '@/lib/api'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { VpnOnboardingWizard } from '@/components/vpn/VpnOnboardingWizard'

interface Props {
  tenantId: string
  open: boolean
  onClose: () => void
}

type ConnectionStatus = 'idle' | 'success' | 'error'

export function AddDeviceForm({ tenantId, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    hostname: '',
    ip_address: '',
    api_port: '8728',
    api_ssl_port: '8729',
    username: '',
    password: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')

  // Check if VPN is enabled for this tenant
  const { data: vpnConfig } = useQuery({
    queryKey: ['vpn-config', tenantId],
    queryFn: () => vpnApi.getConfig(tenantId),
    enabled: open && !!tenantId,
  })

  const vpnEnabled = vpnConfig?.is_enabled ?? false

  const mutation = useMutation({
    mutationFn: () =>
      devicesApi.create(tenantId, {
        hostname: form.hostname || form.ip_address,
        ip_address: form.ip_address,
        api_port: parseInt(form.api_port) || 8728,
        api_ssl_port: parseInt(form.api_ssl_port) || 8729,
        username: form.username,
        password: form.password,
      }),
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
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Connection failed. Check the IP address, port, and credentials.'
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
    setError(null)
    setConnectionStatus('idle')
    onClose()
  }

  const handleVpnSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
    void queryClient.invalidateQueries({ queryKey: ['vpn-peers', tenantId] })
    handleClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.ip_address.trim() || !form.username.trim() || !form.password.trim()) {
      setError('IP address, username, and password are required')
      return
    }
    setError(null)
    setConnectionStatus('idle')
    mutation.mutate()
  }

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    if (error) setError(null)
    setConnectionStatus('idle')
  }

  const directConnectionForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="device-ip">IP Address / Hostname *</Label>
          <Input
            id="device-ip"
            value={form.ip_address}
            onChange={update('ip_address')}
            placeholder="192.168.1.1"
            autoFocus={!vpnEnabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device-hostname">Display Name</Label>
          <Input
            id="device-hostname"
            value={form.hostname}
            onChange={update('hostname')}
            placeholder="router-01 (optional)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device-api-port">API Port</Label>
          <Input
            id="device-api-port"
            value={form.api_port}
            onChange={update('api_port')}
            placeholder="8728"
            type="number"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device-ssl-port">TLS API Port</Label>
          <Input
            id="device-ssl-port"
            value={form.api_ssl_port}
            onChange={update('api_ssl_port')}
            placeholder="8729"
            type="number"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device-username">Username *</Label>
          <Input
            id="device-username"
            value={form.username}
            onChange={update('username')}
            placeholder="admin"
            autoComplete="off"
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="device-password">Password *</Label>
          <Input
            id="device-password"
            type="password"
            value={form.password}
            onChange={update('password')}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
      </div>

      {connectionStatus === 'success' && (
        <div className="flex items-center gap-2 rounded-md bg-success/10 border border-success/50 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
          <p className="text-xs text-success">Device connected and added successfully</p>
        </div>
      )}
      {connectionStatus === 'error' && error && (
        <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
          <XCircle className="h-4 w-4 text-error flex-shrink-0" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={handleClose} size="sm">
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Add Device'}
        </Button>
      </DialogFooter>
    </form>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Device</DialogTitle>
        </DialogHeader>
        {vpnEnabled ? (
          <Tabs defaultValue="vpn" className="mt-2">
            <TabsList className="w-full">
              <TabsTrigger value="vpn" className="flex-1">VPN Onboarding</TabsTrigger>
              <TabsTrigger value="direct" className="flex-1">Direct Connection</TabsTrigger>
            </TabsList>
            <TabsContent value="vpn" className="mt-4">
              <VpnOnboardingWizard
                tenantId={tenantId}
                onSuccess={handleVpnSuccess}
                onCancel={handleClose}
              />
            </TabsContent>
            <TabsContent value="direct" className="mt-4">
              {directConnectionForm}
            </TabsContent>
          </Tabs>
        ) : (
          directConnectionForm
        )}
      </DialogContent>
    </Dialog>
  )
}
