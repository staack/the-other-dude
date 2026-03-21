/**
 * VpnPage — WireGuard VPN management with simple setup flow.
 *
 * States:
 * 1. Not configured → "Enable VPN" button
 * 2. Active → Server info + peer list + add device flow
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/lib/store'
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Plus,
  Trash2,
  Copy,
  Terminal,
  CheckCircle,
  Wifi,
  WifiOff,
  Globe,
  Building2,
} from 'lucide-react'
import {
  vpnApi,
  devicesApi,
  type DeviceResponse,
} from '@/lib/api'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { Button } from '@/components/ui/button'
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
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { DeviceLink } from '@/components/ui/device-link'

export function VpnPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const writable = canWrite(user)

  const { selectedTenantId } = useUIStore()
  const tenantId = isSuperAdmin(user) ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  const [showAddDevice, setShowAddDevice] = useState(false)
  const [showConfig, setShowConfig] = useState<string | null>(null)
  const [selectedDevice, setSelectedDevice] = useState('')
  const [copied, setCopied] = useState(false)

  // ── Queries ──

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['vpn-config', tenantId],
    queryFn: () => vpnApi.getConfig(tenantId),
    enabled: !!tenantId,
  })

  const { data: peers = [], isLoading: peersLoading } = useQuery({
    queryKey: ['vpn-peers', tenantId],
    queryFn: () => vpnApi.listPeers(tenantId),
    enabled: !!tenantId && !!config,
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['devices', tenantId],
    queryFn: () => devicesApi.list(tenantId).then((r: unknown) => {
      const result = r as { items?: DeviceResponse[]; devices?: DeviceResponse[] } | DeviceResponse[]
      if (Array.isArray(result)) return result
      return result.items ?? result.devices ?? []
    }),
    enabled: !!tenantId && showAddDevice,
  })

  const { data: peerConfig } = useQuery({
    queryKey: ['vpn-peer-config', tenantId, showConfig],
    queryFn: () => vpnApi.getPeerConfig(tenantId, showConfig!),
    enabled: !!showConfig,
  })

  // ── Mutations ──

  const setupMutation = useMutation({
    mutationFn: () => vpnApi.setup(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-config'] })
      toast({ title: 'VPN enabled successfully' })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({ title: err?.response?.data?.detail || 'Failed to enable VPN', variant: 'destructive' })
    },
  })

  const addPeerMutation = useMutation({
    mutationFn: (deviceId: string) => vpnApi.addPeer(tenantId, deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-peers'] })
      queryClient.invalidateQueries({ queryKey: ['vpn-config'] })
      setShowAddDevice(false)
      setSelectedDevice('')
      toast({ title: 'Device added to VPN' })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({ title: err?.response?.data?.detail || 'Failed to add device', variant: 'destructive' })
    },
  })

  const removePeerMutation = useMutation({
    mutationFn: (peerId: string) => vpnApi.removePeer(tenantId, peerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-peers'] })
      queryClient.invalidateQueries({ queryKey: ['vpn-config'] })
      toast({ title: 'Device removed from VPN' })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({ title: err?.response?.data?.detail || 'Failed to remove device', variant: 'destructive' })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => vpnApi.updateConfig(tenantId, { is_enabled: enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-config'] })
      toast({ title: 'VPN updated' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => vpnApi.deleteConfig(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-config'] })
      queryClient.invalidateQueries({ queryKey: ['vpn-peers'] })
      toast({ title: 'VPN configuration deleted' })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({ title: err?.response?.data?.detail || 'Failed to delete VPN', variant: 'destructive' })
    },
  })

  // ── Helpers ──

  const connectedPeerIds = new Set(peers.map((p) => p.device_id))
  const availableDevices = devices.filter(
    (d: DeviceResponse) => !connectedPeerIds.has(d.id),
  )

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast({ title: 'Copied to clipboard' })
  }

  // Super admin needs to select a tenant first
  if (isSuperAdmin(user) && !tenantId) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-text-muted" />
          <h1 className="text-2xl font-bold text-text-primary">VPN</h1>
        </div>
        <EmptyState
          icon={Building2}
          title="Select an Organization"
          description="Select an organization from the header to view VPN peers."
        />
      </div>
    )
  }

  if (configLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">VPN</h1>
        <TableSkeleton />
      </div>
    )
  }

  // ── Not configured state ──

  if (!config) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">VPN</h1>
        <div className="max-w-lg mx-auto mt-12">
          <div className="rounded-lg border border-border bg-panel p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
              <Shield className="h-8 w-8 text-accent" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">
                Connect Remote Devices
              </h2>
              <p className="text-sm text-text-secondary mt-2 max-w-sm mx-auto">
                Enable WireGuard VPN so your MikroTik devices can securely connect
                to the portal from anywhere — no port forwarding needed on the device side.
              </p>
            </div>

            {writable && (
              <Button
                onClick={() => setupMutation.mutate()}
                disabled={setupMutation.isPending}
                className="w-full"
                size="lg"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {setupMutation.isPending ? 'Setting up...' : 'Enable VPN'}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Active state ──

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">VPN</h1>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
              config.is_enabled
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning',
            )}
          >
            {config.is_enabled ? (
              <><ShieldCheck className="h-3 w-3" /> Active</>
            ) : (
              <><ShieldOff className="h-3 w-3" /> Disabled</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {writable && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleMutation.mutate(!config.is_enabled)}
              >
                {config.is_enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button size="sm" onClick={() => setShowAddDevice(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Device
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-error border-error/30 hover:bg-error/10"
                onClick={() => {
                  if (confirm('Delete VPN configuration? All peers will be removed.')) {
                    deleteMutation.mutate()
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                Delete VPN
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Server info card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfoCard
          label="Server Address"
          value={config.endpoint || 'Not set'}
          icon={Globe}
          muted={!config.endpoint}
        />
        <InfoCard
          label="Subnet"
          value={config.subnet}
          icon={Wifi}
        />
        <InfoCard
          label="VPN Peers"
          value={`${peers.filter((p) => p.last_handshake).length} / ${peers.length} connected`}
          icon={ShieldCheck}
        />
      </div>

      {/* Peer list */}
      {peersLoading ? (
        <TableSkeleton />
      ) : peers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-accent/30 bg-accent/5 p-8 text-center space-y-3">
          <ShieldCheck className="h-10 w-10 text-accent mx-auto" />
          <h3 className="text-base font-semibold text-text-primary">VPN is ready</h3>
          <p className="text-sm text-text-secondary max-w-md mx-auto">
            Your WireGuard server is running. Add your first device to create a secure tunnel.
          </p>
          {writable && (
            <Button size="sm" onClick={() => setShowAddDevice(true)} className="mt-2">
              <Plus className="h-4 w-4 mr-1" /> Add Your First Device
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-elevated/50 text-left">
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Device</th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">VPN IP</th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Added</th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {peers.map((peer) => (
                <tr key={peer.id} className="hover:bg-elevated/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm text-text-primary">
                      {peer.device_id ? (
                        <DeviceLink tenantId={tenantId} deviceId={peer.device_id}>
                          {peer.device_hostname}
                        </DeviceLink>
                      ) : peer.device_hostname}
                    </div>
                    <div className="text-xs text-text-muted">{peer.device_ip}</div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-sm font-mono text-accent">{peer.assigned_ip}</code>
                  </td>
                  <td className="px-4 py-3">
                    {peer.last_handshake ? (
                      <span className="inline-flex items-center gap-1 text-success text-xs">
                        <Wifi className="h-3 w-3" /> Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-text-muted text-xs">
                        <WifiOff className="h-3 w-3" /> Awaiting connection
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">
                    {new Date(peer.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowConfig(peer.id)}
                        title="View setup commands"
                      >
                        <Terminal className="h-4 w-4" />
                      </Button>
                      {writable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removePeerMutation.mutate(peer.id)}
                          className="text-error hover:text-error/80"
                          title="Remove from VPN"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Device Dialog */}
      <Dialog open={showAddDevice} onOpenChange={setShowAddDevice}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Device to VPN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-text-secondary">
              Select a device to create a WireGuard tunnel. You'll get RouterOS commands to paste on the device.
            </p>
            {availableDevices.length === 0 ? (
              <div className="rounded-lg border border-border bg-elevated/50 p-4 text-center">
                <CheckCircle className="h-6 w-6 text-success mx-auto mb-2" />
                <p className="text-sm font-medium text-text-primary">All devices are on VPN</p>
                <p className="text-xs text-text-muted mt-1">
                  Every device in your fleet is already connected. Add more devices to your fleet first.
                </p>
              </div>
            ) : (
              <>
                <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a device..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDevices.map((d: DeviceResponse) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.hostname} ({d.ip_address})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  disabled={!selectedDevice || addPeerMutation.isPending}
                  onClick={() => selectedDevice && addPeerMutation.mutate(selectedDevice)}
                >
                  {addPeerMutation.isPending ? 'Adding...' : 'Add to VPN'}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Config Dialog */}
      <Dialog open={!!showConfig} onOpenChange={() => setShowConfig(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Device Setup</DialogTitle>
          </DialogHeader>
          {peerConfig && (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-text-secondary">
                Paste these commands into your MikroTik device terminal to connect it to the VPN.
              </p>
              <div className="relative">
                <pre className="rounded-lg bg-elevated p-4 text-sm font-mono text-text-primary overflow-x-auto whitespace-pre-wrap">
                  {peerConfig.routeros_commands.join('\n')}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(peerConfig.routeros_commands.join('\n'))}
                >
                  {copied ? <CheckCircle className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-text-muted">VPN IP:</span>
                  <span className="ml-2 font-mono text-text-primary">{peerConfig.assigned_ip}</span>
                </div>
                <div>
                  <span className="text-text-muted">Server:</span>
                  <span className="ml-2 font-mono text-text-primary">{peerConfig.server_endpoint}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Reusable info card ──

function InfoCard({
  label,
  value,
  icon: Icon,
  muted,
}: {
  label: string
  value: string
  icon: React.FC<{ className?: string }>
  muted?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-text-muted" />
        <span className="text-xs text-text-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn('text-lg font-semibold', muted ? 'text-text-muted italic' : 'text-text-primary')}>
        {value}
      </div>
    </div>
  )
}
