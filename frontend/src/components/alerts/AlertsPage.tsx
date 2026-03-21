/**
 * AlertsPage — Active alerts and alert history with filtering, acknowledge, and silence.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeviceLink } from '@/components/ui/device-link'
import {
  Bell,
  BellOff,
  BellRing,
  Building2,
  CheckCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { alertsApi, type AlertEvent, type AlertsFilterParams } from '@/lib/alertsApi'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
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
import { toast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'

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

function StatusIcon({ status }: { status: string }) {
  if (status === 'firing') return <BellRing className="h-4 w-4 text-error" />
  if (status === 'resolved') return <CheckCircle className="h-4 w-4 text-success" />
  if (status === 'flapping') return <AlertTriangle className="h-4 w-4 text-warning" />
  return <Bell className="h-4 w-4 text-text-muted" />
}

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

function AlertRow({
  alert,
  tenantId,
  onAcknowledge,
  onSilence,
}: {
  alert: AlertEvent
  tenantId: string
  onAcknowledge: (alertId: string) => void
  onSilence: (alertId: string, minutes: number) => void
}) {
  const isSilenced =
    alert.silenced_until && new Date(alert.silenced_until) > new Date()

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-panel transition-colors">
      <StatusIcon status={alert.status} />
      <SeverityBadge severity={alert.severity} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary truncate">
            {alert.message ?? `${alert.metric} ${alert.value ?? ''}`}
          </span>
          {alert.is_flapping && (
            <span className="text-[10px] text-warning/80 border border-warning/40 rounded px-1">
              flapping
            </span>
          )}
          {isSilenced && <BellOff className="h-3 w-3 text-text-muted" />}
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
          <DeviceLink tenantId={tenantId} deviceId={alert.device_id}>
            {alert.device_hostname ?? alert.device_id.slice(0, 8)}
          </DeviceLink>
          {alert.rule_name && <span>{alert.rule_name}</span>}
          {alert.threshold != null && (
            <span>
              {alert.value != null ? alert.value.toFixed(1) : '?'} / {alert.threshold}
            </span>
          )}
          <span>{timeAgo(alert.fired_at)}</span>
          {alert.resolved_at && (
            <span className="text-success/60">
              resolved {timeAgo(alert.resolved_at)}
            </span>
          )}
        </div>
      </div>

      {alert.status === 'firing' && !alert.acknowledged_at && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onAcknowledge(alert.id)}
        >
          Acknowledge
        </Button>
      )}

      {alert.status === 'firing' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs">
              <BellOff className="h-3 w-3 mr-1" />
              Silence
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onSilence(alert.id, 15)}>15 min</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSilence(alert.id, 60)}>1 hour</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSilence(alert.id, 240)}>4 hours</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSilence(alert.id, 480)}>8 hours</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSilence(alert.id, 1440)}>24 hours</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function AlertsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('active')
  const [severity, setSeverity] = useState<string>('')
  const [page, setPage] = useState(1)

  // For super_admin, use global org context; for normal users, use their tenant
  const { selectedTenantId } = useUIStore()

  const tenantId = isSuperAdmin(user) ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // Build filter params
  const params: AlertsFilterParams = {
    page,
    per_page: 50,
  }
  if (tab === 'active') {
    params.status = 'firing'
  }
  if (severity) {
    params.severity = severity
  }

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['alerts', tenantId, tab, severity, page],
    queryFn: () => alertsApi.getAlerts(tenantId, params),
    enabled: !!tenantId,
    refetchInterval: tab === 'active' ? 30_000 : undefined,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => alertsApi.acknowledgeAlert(tenantId, alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['alert-active-count'] })
      toast({ title: 'Alert acknowledged' })
    },
    onError: () => toast({ title: 'Failed to acknowledge', variant: 'destructive' }),
  })

  const silenceMutation = useMutation({
    mutationFn: ({ alertId, minutes }: { alertId: string; minutes: number }) =>
      alertsApi.silenceAlert(tenantId, alertId, minutes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['alert-active-count'] })
      toast({ title: 'Alert silenced' })
    },
    onError: () => toast({ title: 'Failed to silence', variant: 'destructive' }),
  })

  const alerts = alertsData?.items ?? []
  const total = alertsData?.total ?? 0
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-text-muted" />
          <h1 className="text-lg font-semibold">Alerts</h1>
        </div>

      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={severity}
          onValueChange={(v) => {
            setSeverity(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1) }}>
        <TabsList>
          <TabsTrigger value="active">
            Active
            {tab === 'active' && total > 0 && (
              <span className="ml-2 bg-error/20 text-error text-xs px-1.5 rounded-full">
                {total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          {!tenantId ? (
            <div className="flex flex-col items-center gap-2 py-12 text-text-muted">
              <Building2 className="h-8 w-8" />
              <p className="text-sm">Select an organization from the header to view alerts.</p>
            </div>
          ) : isLoading ? (
            <TableSkeleton />
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title="No active alerts"
              description="All clear! No alerts have been triggered."
            />
          ) : (
            <div className="rounded-lg border border-border bg-panel overflow-hidden">
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  tenantId={tenantId}
                  onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
                  onSilence={(id, mins) =>
                    silenceMutation.mutate({ alertId: id, minutes: mins })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          {!tenantId ? (
            <div className="flex flex-col items-center gap-2 py-12 text-text-muted">
              <Building2 className="h-8 w-8" />
              <p className="text-sm">Select an organization from the header to view alerts.</p>
            </div>
          ) : isLoading ? (
            <TableSkeleton />
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title="No alert history"
              description="Alert events will appear here as they are triggered and resolved."
            />
          ) : (
            <div className="rounded-lg border border-border bg-panel overflow-hidden">
              {/* Table header */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                <span className="w-5" />
                <span className="w-16">Severity</span>
                <span className="w-16">Status</span>
                <span className="flex-1">Details</span>
                <span className="w-24">Fired</span>
                <span className="w-24">Resolved</span>
              </div>
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 hover:bg-panel text-sm"
                >
                  <StatusIcon status={alert.status} />
                  <span className="w-16">
                    <SeverityBadge severity={alert.severity} />
                  </span>
                  <span
                    className={cn(
                      'w-16 text-xs',
                      alert.status === 'firing'
                        ? 'text-error'
                        : alert.status === 'resolved'
                          ? 'text-success'
                          : 'text-warning',
                    )}
                  >
                    {alert.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-text-primary truncate block">
                      {alert.message ?? alert.metric ?? 'System alert'}
                    </span>
                    <span className="text-xs text-text-muted">
                      <DeviceLink tenantId={tenantId} deviceId={alert.device_id}>
                        {alert.device_hostname ?? alert.device_id.slice(0, 8)}
                      </DeviceLink>
                      {alert.rule_name && ` — ${alert.rule_name}`}
                    </span>
                  </div>
                  <span className="w-24 text-xs text-text-muted">
                    {formatDateTime(alert.fired_at)}
                  </span>
                  <span className="w-24 text-xs text-text-muted">
                    {alert.resolved_at ? formatDateTime(alert.resolved_at) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-text-muted">
            {total} alert{total !== 1 ? 's' : ''} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-text-secondary">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
