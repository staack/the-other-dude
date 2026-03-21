import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Tag,
  FolderOpen,
  BellOff,
  BellRing,
  MapPin,
  CheckCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Shield,
} from 'lucide-react'
import { devicesApi, deviceGroupsApi, deviceTagsApi, configApi, sitesApi, type DeviceResponse, type DeviceUpdate } from '@/lib/api'
import { alertsApi } from '@/lib/alertsApi'
import { useAuth, canWrite, canDelete } from '@/lib/auth'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatUptime, formatDateTime, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { DetailPageSkeleton } from '@/components/ui/page-skeleton'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { InterfaceGauges } from '@/components/network/InterfaceGauges'
import { ConfigHistorySection } from '@/components/config/ConfigHistorySection'
// Phase 27: Simple Configuration Interface
import { useSimpleConfigMode } from '@/hooks/useSimpleConfig'
import { SimpleModeToggle } from '@/components/simple-config/SimpleModeToggle'
import { SimpleConfigView } from '@/components/simple-config/SimpleConfigView'
import { WinBoxButton } from '@/components/fleet/WinBoxButton'
import { RemoteWinBoxButton } from '@/components/fleet/RemoteWinBoxButton'
import { SSHTerminal } from '@/components/fleet/SSHTerminal'
import { RollbackAlert } from '@/components/config/RollbackAlert'

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantId/devices/$deviceId',
)({
  component: DeviceDetailPage,
})

// ---------------------------------------------------------------------------
// Edit Device Dialog
// ---------------------------------------------------------------------------

function EditDeviceDialog({
  device,
  tenantId,
  open,
  onOpenChange,
}: {
  device: DeviceResponse
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<DeviceUpdate>({
    hostname: device.hostname,
    ip_address: device.ip_address,
    api_port: device.api_port,
    api_ssl_port: device.api_ssl_port,
    username: '',
    password: '',
    latitude: device.latitude ?? undefined,
    longitude: device.longitude ?? undefined,
  })

  const updateMutation = useMutation({
    mutationFn: (data: DeviceUpdate) => devicesApi.update(tenantId, device.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, device.id] })
      void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      toast({ title: 'Device updated' })
      onOpenChange(false)
    },
    onError: () => toast({ title: 'Failed to update device', variant: 'destructive' }),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Only send fields that are non-empty strings / defined numbers
    const payload: DeviceUpdate = {
      hostname: form.hostname || undefined,
      ip_address: form.ip_address || undefined,
      api_port: form.api_port,
      api_ssl_port: form.api_ssl_port,
      latitude: form.latitude,
      longitude: form.longitude,
    }
    // Only include credentials if the user typed something
    if (form.username) payload.username = form.username
    if (form.password) payload.password = form.password
    updateMutation.mutate(payload)
  }

  const field = (
    id: string,
    label: string,
    value: string | number | undefined,
    onChange: (v: string) => void,
    opts?: { type?: string; placeholder?: string },
  ) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-text-secondary">
        {label}
      </Label>
      <Input
        id={id}
        type={opts?.type ?? 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={opts?.placeholder}
        className="h-8 text-sm"
      />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-edit-device">
        <DialogHeader>
          <DialogTitle>Edit Device</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            {field('hostname', 'Hostname', form.hostname, (v) => setForm((f) => ({ ...f, hostname: v })))}
            {field('ip_address', 'IP Address', form.ip_address, (v) => setForm((f) => ({ ...f, ip_address: v })))}
            {field('api_port', 'API Port', form.api_port, (v) => setForm((f) => ({ ...f, api_port: parseInt(v) || undefined })), { type: 'number' })}
            {field('api_ssl_port', 'API TLS Port', form.api_ssl_port, (v) => setForm((f) => ({ ...f, api_ssl_port: parseInt(v) || undefined })), { type: 'number' })}
          </div>

          <div className="border-t border-border pt-3 space-y-1">
            <p className="text-xs text-text-muted mb-2">Leave blank to keep existing credentials</p>
            <div className="grid grid-cols-2 gap-3">
              {field('username', 'Username', form.username, (v) => setForm((f) => ({ ...f, username: v })), { placeholder: 'unchanged' })}
              {field('password', 'Password', form.password, (v) => setForm((f) => ({ ...f, password: v })), { type: 'password', placeholder: 'unchanged' })}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-text-muted mb-2">GPS coordinates (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              {field('latitude', 'Latitude', form.latitude, (v) => setForm((f) => ({ ...f, latitude: v ? parseFloat(v) : undefined })), { type: 'number', placeholder: '0.000000' })}
              {field('longitude', 'Longitude', form.longitude, (v) => setForm((f) => ({ ...f, longitude: v ? parseFloat(v) : undefined })), { type: 'number', placeholder: '0.000000' })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TlsSecurityBadge({ tlsMode }: { tlsMode: string }) {
  const config: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    portal_ca: { label: 'CA Verified', icon: ShieldCheck, color: 'text-success' },
    auto: { label: 'Self-Signed TLS', icon: Shield, color: 'text-warning' },
    insecure: { label: 'Insecure TLS', icon: ShieldAlert, color: 'text-warning' },
    plain: { label: 'Plain-Text', icon: ShieldOff, color: 'text-error' },
  }
  const c = config[tlsMode] ?? config.auto
  const Icon = c.icon
  return (
    <span className={cn('flex-shrink-0', c.color)} title={c.label}>
      <Icon className="h-3 w-3" />
    </span>
  )
}

function TlsModeSelector({
  tenantId,
  deviceId,
  currentMode,
}: {
  tenantId: string
  deviceId: string
  currentMode: string
}) {
  const queryClient = useQueryClient()
  const [confirmPlain, setConfirmPlain] = useState(false)
  const [pendingMode, setPendingMode] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: (mode: string) => devicesApi.update(tenantId, deviceId, { tls_mode: mode }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, deviceId] })
      toast({ title: 'TLS mode updated' })
      setConfirmPlain(false)
      setPendingMode(null)
    },
    onError: () => toast({ title: 'Failed to update TLS mode', variant: 'destructive' }),
  })

  const handleChange = (value: string) => {
    if (value === 'plain') {
      setPendingMode(value)
      setConfirmPlain(true)
    } else {
      updateMutation.mutate(value)
    }
  }

  return (
    <>
      <Select value={currentMode} onValueChange={handleChange}>
        <SelectTrigger className="h-7 text-xs w-36" data-testid="select-tls-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto (recommended)</SelectItem>
          <SelectItem value="portal_ca">CA Verified</SelectItem>
          <SelectItem value="insecure">Insecure TLS</SelectItem>
          <SelectItem value="plain">Plain-Text</SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={confirmPlain} onOpenChange={setConfirmPlain}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-error">
              <ShieldOff className="h-5 w-5" />
              Enable Plain-Text Connection?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              Plain-text mode sends credentials and all data unencrypted over the network.
              This is a serious security risk and should only be used for devices that
              do not support TLS at all.
            </p>
            <div className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
              Credentials will be transmitted in clear text. Anyone on the network
              can intercept them.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPlain(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={updateMutation.isPending}
              onClick={() => pendingMode && updateMutation.mutate(pendingMode)}
            >
              {updateMutation.isPending ? 'Saving...' : 'Enable Plain-Text'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1 border-b border-border-subtle last:border-0">
      <span className="text-[10px] text-text-muted w-24 flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary flex-1">{value ?? '—'}</span>
    </div>
  )
}

function DeviceDetailPage() {
  const { tenantId, deviceId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [showCreds, setShowCreds] = useState(false)
  const [activeTab, setActiveTabRaw] = useState('overview')
  const setActiveTab = (tab: string) => {
    setActiveTabRaw(tab)
    document.getElementById('main-content')?.scrollTo(0, 0)
  }
  const [editOpen, setEditOpen] = useState(false)
  const { mode, toggleMode } = useSimpleConfigMode(deviceId)

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', tenantId, deviceId],
    queryFn: () => devicesApi.get(tenantId, deviceId),
  })

  const { data: backups } = useQuery({
    queryKey: ['config-backups', tenantId, deviceId],
    queryFn: () => configApi.listBackups(tenantId, deviceId),
  })

  // True if a pre-restore backup was created within the last 30 minutes,
  // indicating a config push just happened before the device went offline.
  const hasRecentPushAlert = backups?.some((b) => {
    if (b.trigger_type !== 'pre-restore') return false
    // created_at within last 30 minutes — compare timestamps without Date.now()
    const thirtyMinAgo = new Date()
    thirtyMinAgo.setMinutes(thirtyMinAgo.getMinutes() - 30)
    return new Date(b.created_at) > thirtyMinAgo
  }) ?? false

  const { data: groups } = useQuery({
    queryKey: ['device-groups', tenantId],
    queryFn: () => deviceGroupsApi.list(tenantId),
    enabled: canWrite(user),
  })

  const { data: tags } = useQuery({
    queryKey: ['device-tags', tenantId],
    queryFn: () => deviceTagsApi.list(tenantId),
    enabled: canWrite(user),
  })

  const { data: sitesData } = useQuery({
    queryKey: ['sites', tenantId],
    queryFn: () => sitesApi.list(tenantId),
  })

  const siteAssignMutation = useMutation({
    mutationFn: async (value: string) => {
      if (value === 'unassigned') {
        if (device?.site_id) {
          await sitesApi.removeDevice(tenantId, device.site_id, deviceId)
        }
      } else {
        await sitesApi.assignDevice(tenantId, value, deviceId)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, deviceId] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: () => toast({ title: 'Failed to update site assignment', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => devicesApi.delete(tenantId, deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: 'Device deleted' })
      void navigate({ to: '/tenants/$tenantId/devices', params: { tenantId } })
    },
    onError: () => toast({ title: 'Failed to delete device', variant: 'destructive' }),
  })

  const addToGroupMutation = useMutation({
    mutationFn: (groupId: string) => devicesApi.addToGroup(tenantId, deviceId, groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, deviceId] })
    },
    onError: () => toast({ title: 'Failed to add to group', variant: 'destructive' }),
  })

  const removeFromGroupMutation = useMutation({
    mutationFn: (groupId: string) => devicesApi.removeFromGroup(tenantId, deviceId, groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, deviceId] })
    },
    onError: () => toast({ title: 'Failed to remove from group', variant: 'destructive' }),
  })

  const addTagMutation = useMutation({
    mutationFn: (tagId: string) => devicesApi.addTag(tenantId, deviceId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, deviceId] })
    },
    onError: () => toast({ title: 'Failed to add tag', variant: 'destructive' }),
  })

  const removeTagMutation = useMutation({
    mutationFn: (tagId: string) => devicesApi.removeTag(tenantId, deviceId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device', tenantId, deviceId] })
    },
    onError: () => toast({ title: 'Failed to remove tag', variant: 'destructive' }),
  })

  const handleDelete = () => {
    if (confirm(`Delete device "${device?.hostname}"? This cannot be undone.`)) {
      deleteMutation.mutate()
    }
  }

  if (isLoading) {
    return <DetailPageSkeleton />
  }

  if (!device) {
    return <div className="text-text-muted text-sm">Device not found</div>
  }

  const deviceGroupIds = new Set(device.groups.map((g) => g.id))
  const deviceTagIds = new Set(device.tags.map((t) => t.id))

  const availableGroups = groups?.filter((g) => !deviceGroupIds.has(g.id)) ?? []
  const availableTags = tags?.filter((t) => !deviceTagIds.has(t.id)) ?? []

  return (
    <div className={cn('space-y-4', mode === 'simple' ? 'max-w-5xl' : 'max-w-3xl')} data-testid="device-detail">
      {/* Device workspace header */}
      <div className="bg-sidebar border border-border-default rounded-sm px-3 py-1.5">
        {/* Top row: device identity */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Link
            to="/tenants/$tenantId/devices"
            params={{ tenantId }}
            className="text-[8px] text-text-muted hover:text-text-secondary transition-[color] duration-[50ms] flex-shrink-0"
          >
            Devices
          </Link>
          <span className="text-[8px] text-text-muted flex-shrink-0">&rsaquo;</span>
          <div className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            device.status === 'online' ? 'bg-online' :
            device.status === 'degraded' ? 'bg-warning' : 'bg-offline'
          )} />
          <h1 className="text-[13px] font-semibold text-text-primary truncate" data-testid="device-hostname">
            {device.hostname}
          </h1>
          <span className={cn(
            'text-[9px] flex-shrink-0',
            device.status === 'online' ? 'text-online' :
            device.status === 'degraded' ? 'text-warning' : 'text-offline'
          )}>
            {device.status}
          </span>
          <TlsSecurityBadge tlsMode={device.tls_mode} />
        </div>
        {/* Metadata + actions row */}
        <div className="flex items-center justify-between mt-0.5 gap-2">
          <div className="text-[9px] text-text-secondary truncate pl-[9px]">
            {device.model ?? device.board_name ?? '\u2014'}
            {' \u00b7 '}
            <span className="font-mono text-[8px]">{device.ip_address}</span>
            {device.routeros_version && (
              <>
                {' \u00b7 '}
                <span className="font-mono text-[8px]">v{device.routeros_version}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <SimpleModeToggle mode={mode} onModeChange={toggleMode} />
            {user?.role !== 'viewer' && device.routeros_version !== null && (
              <>
                <WinBoxButton tenantId={tenantId} deviceId={deviceId} />
                <RemoteWinBoxButton tenantId={tenantId} deviceId={deviceId} />
              </>
            )}
            {user?.role !== 'viewer' && (
              <SSHTerminal tenantId={tenantId} deviceId={deviceId} deviceName={device.hostname} />
            )}
            {canWrite(user) && (
              <Button variant="ghost" size="icon" className="h-6 w-6 text-text-muted" onClick={() => setEditOpen(true)} data-testid="button-edit-device">
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            {canDelete(user) && (
              <Button variant="ghost" size="icon" className="h-6 w-6 text-text-muted" onClick={handleDelete} data-testid="button-delete-device">
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Emergency rollback banner */}
      <RollbackAlert
        tenantId={tenantId}
        deviceId={deviceId}
        deviceStatus={device.status}
        hasRecentPushAlert={hasRecentPushAlert}
      />

      {/* Config View (Simple or Standard) */}
      <SimpleConfigView
        tenantId={tenantId}
        deviceId={deviceId}
        device={device}
        mode={mode}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onModeChange={toggleMode}
        overviewContent={
          <>
            {/* Device info */}
            <div className="rounded-sm border border-border-default bg-panel px-3 py-1.5">
              <InfoRow label="Model" value={device.model} />
              <InfoRow label="RouterOS" value={device.routeros_version} />
              <InfoRow label="Firmware" value={device.firmware_version || 'N/A'} />
              <InfoRow label="Uptime" value={formatUptime(device.uptime_seconds)} />
              <InfoRow label="Last Seen" value={formatDateTime(device.last_seen)} />
              <InfoRow label="Serial" value={device.serial_number || 'N/A'} />
              <InfoRow label="API Port" value={`${device.api_port} (plain) / ${device.api_ssl_port} (TLS)`} />
              <InfoRow
                label="TLS Mode"
                value={
                  <div className="flex items-center gap-2">
                    <TlsSecurityBadge tlsMode={device.tls_mode} />
                    {(user?.role === 'admin' || user?.role === 'super_admin') && (
                      <TlsModeSelector
                        tenantId={tenantId}
                        deviceId={device.id}
                        currentMode={device.tls_mode}
                      />
                    )}
                  </div>
                }
              />
              <InfoRow label="Added" value={formatDate(device.created_at)} />
              <InfoRow
                label="Site"
                value={
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-text-muted" />
                    {canWrite(user) ? (
                      <Select
                        value={device.site_id ?? 'unassigned'}
                        onValueChange={(value) => siteAssignMutation.mutate(value)}
                      >
                        <SelectTrigger className="h-7 w-[160px] text-xs">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {sitesData?.sites.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">{device.site_name ?? 'Unassigned'}</span>
                    )}
                  </div>
                }
              />
            </div>

            {/* Credentials (masked) */}
            <div className="rounded-sm border border-border-default bg-panel px-3 py-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-text-secondary">Credentials</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreds((v) => !v)}
                  className="h-6 px-2 text-xs"
                >
                  {showCreds ? (
                    <>
                      <EyeOff className="h-3 w-3" /> Hide
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" /> Reveal
                    </>
                  )}
                </Button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex gap-4">
                  <span className="text-xs text-text-muted w-20">Username</span>
                  <span className="font-mono">
                    {showCreds ? '(stored \u2014 not returned by API)' : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                  </span>
                </div>
                <div className="flex gap-4">
                  <span className="text-xs text-text-muted w-20">Password</span>
                  <span className="font-mono">
                    {showCreds ? '(encrypted at rest \u2014 not returned by API)' : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                  </span>
                </div>
              </div>
            </div>

            {/* Groups */}
            <div className="rounded-sm border border-border-default bg-panel px-3 py-2 space-y-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-text-muted" />
                <h3 className="text-sm font-medium text-text-secondary">Groups</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {device.groups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-1 text-xs border border-border-default rounded px-2 py-1"
                  >
                    {group.name}
                    {canWrite(user) && (
                      <button
                        onClick={() => removeFromGroupMutation.mutate(group.id)}
                        className="text-text-muted hover:text-text-secondary ml-1"
                        title="Remove from group"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                {device.groups.length === 0 && (
                  <span className="text-xs text-text-muted">No groups assigned</span>
                )}
              </div>
              {canWrite(user) && availableGroups.length > 0 && (
                <div className="flex items-center gap-2">
                  <Select onValueChange={(id) => addToGroupMutation.mutate(id)}>
                    <SelectTrigger className="h-7 text-xs w-48">
                      <SelectValue placeholder="Add to group..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableGroups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="rounded-sm border border-border-default bg-panel px-3 py-2 space-y-3">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-text-muted" />
                <h3 className="text-sm font-medium text-text-secondary">Tags</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {device.tags.map((tag) => (
                  <div key={tag.id} className="flex items-center gap-1">
                    <Badge color={tag.color}>
                      {tag.name}
                      {canWrite(user) && (
                        <button
                          onClick={() => removeTagMutation.mutate(tag.id)}
                          className="ml-1 opacity-60 hover:opacity-100"
                          title="Remove tag"
                        >
                          &times;
                        </button>
                      )}
                    </Badge>
                  </div>
                ))}
                {device.tags.length === 0 && (
                  <span className="text-xs text-text-muted">No tags assigned</span>
                )}
              </div>
              {canWrite(user) && availableTags.length > 0 && (
                <Select onValueChange={(id) => addTagMutation.mutate(id)}>
                  <SelectTrigger className="h-7 text-xs w-48">
                    <SelectValue placeholder="Add tag..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTags.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Interface Utilization */}
            <div className="rounded-lg border border-border bg-panel p-4">
              <h3 className="text-sm font-medium text-text-muted mb-3">Interface Utilization</h3>
              <InterfaceGauges tenantId={tenantId} deviceId={deviceId} active={activeTab === 'overview'} />
            </div>

            {/* Configuration History */}
            <ConfigHistorySection tenantId={tenantId} deviceId={deviceId} deviceName={device.hostname} />
          </>
        }
        alertsContent={
          <DeviceAlertsSection tenantId={tenantId} deviceId={deviceId} active={activeTab === 'alerts'} />
        }
      />

      {canWrite(user) && (
        <EditDeviceDialog
          device={device}
          tenantId={tenantId}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Device Alerts Section
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, string> = {
    critical: 'bg-error/20 text-error border-error/40',
    warning: 'bg-warning/20 text-warning border-warning/40',
    info: 'bg-info/20 text-info border-info/40',
  }
  return (
    <span
      className={cn(
        'text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border',
        config[severity] ?? config.info,
      )}
    >
      {severity}
    </span>
  )
}

function DeviceAlertsSection({
  tenantId,
  deviceId,
  active,
}: {
  tenantId: string
  deviceId: string
  active: boolean
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [showResolved, setShowResolved] = useState(false)

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['device-alerts', tenantId, deviceId],
    queryFn: () => alertsApi.getDeviceAlerts(tenantId, deviceId, { per_page: 20 }),
    enabled: active,
    refetchInterval: active ? 30_000 : undefined,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => alertsApi.acknowledgeAlert(tenantId, alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['alert-active-count'] })
      toast({ title: 'Alert acknowledged' })
    },
  })

  const silenceMutation = useMutation({
    mutationFn: ({ alertId, minutes }: { alertId: string; minutes: number }) =>
      alertsApi.silenceAlert(tenantId, alertId, minutes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['device-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['alert-active-count'] })
      toast({ title: 'Alert silenced' })
    },
  })

  const alerts = alertsData?.items ?? []
  const firingAlerts = alerts.filter((a) => a.status === 'firing')
  const resolvedAlerts = alerts.filter((a) => a.status === 'resolved').slice(0, 5)

  if (isLoading) {
    return <TableSkeleton />
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Active alerts */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
          <BellRing className="h-4 w-4" />
          Active Alerts
          {firingAlerts.length > 0 && (
            <span className="bg-error/20 text-error text-xs px-1.5 rounded-full">
              {firingAlerts.length}
            </span>
          )}
        </h3>

        {firingAlerts.length === 0 ? (
          <div className="rounded-lg border border-border bg-panel p-6 text-center">
            <CheckCircle className="h-6 w-6 text-success/50 mx-auto mb-1" />
            <p className="text-xs text-text-muted">No active alerts for this device.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-panel overflow-hidden">
            {firingAlerts.map((alert) => {
              const isSilenced =
                alert.silenced_until && new Date(alert.silenced_until) > new Date()
              return (
                <div
                  key={alert.id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0"
                >
                  <BellRing className="h-4 w-4 text-error flex-shrink-0" />
                  <SeverityBadge severity={alert.severity} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary truncate block">
                      {alert.message ?? `${alert.metric} ${alert.value ?? ''}`}
                    </span>
                    <span className="text-xs text-text-muted">
                      {alert.rule_name && `${alert.rule_name} — `}
                      {alert.threshold != null &&
                        `${alert.value != null ? Number(alert.value).toFixed(1) : '?'} / ${alert.threshold}`}
                      {' — '}
                      {timeAgo(alert.fired_at)}
                      {isSilenced && ' (silenced)'}
                    </span>
                  </div>
                  {!alert.acknowledged_at && canWrite(user) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => acknowledgeMutation.mutate(alert.id)}
                    >
                      Ack
                    </Button>
                  )}
                  {canWrite(user) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs">
                          <BellOff className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onClick={() =>
                            silenceMutation.mutate({ alertId: alert.id, minutes: 15 })
                          }
                        >
                          15 min
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            silenceMutation.mutate({ alertId: alert.id, minutes: 60 })
                          }
                        >
                          1 hour
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            silenceMutation.mutate({ alertId: alert.id, minutes: 240 })
                          }
                        >
                          4 hours
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            silenceMutation.mutate({ alertId: alert.id, minutes: 1440 })
                          }
                        >
                          24 hours
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Resolved alerts */}
      {resolvedAlerts.length > 0 && (
        <div>
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-sm font-medium text-text-muted hover:text-text-secondary flex items-center gap-2 mb-2"
          >
            <CheckCircle className="h-4 w-4" />
            Recent Resolved ({resolvedAlerts.length})
            <span className="text-xs">{showResolved ? '(hide)' : '(show)'}</span>
          </button>

          {showResolved && (
            <div className="rounded-lg border border-border bg-panel overflow-hidden">
              {resolvedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center gap-3 px-4 py-2 border-b border-border/50 last:border-0 opacity-60"
                >
                  <CheckCircle className="h-3.5 w-3.5 text-success flex-shrink-0" />
                  <SeverityBadge severity={alert.severity} />
                  <span className="text-xs text-text-secondary flex-1 truncate">
                    {alert.message ?? alert.metric ?? 'System alert'}
                  </span>
                  <span className="text-xs text-text-muted">
                    {alert.resolved_at ? timeAgo(alert.resolved_at) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Link to full alerts page */}
      <div className="text-center">
        <Link
          to="/alerts"
          className="text-xs text-info hover:text-accent"
        >
          View all alerts for this device
        </Link>
      </div>
    </div>
  )
}
