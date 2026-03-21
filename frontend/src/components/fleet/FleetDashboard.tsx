import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth'
import { metricsApi, tenantsApi, type FleetDevice } from '@/lib/api'
import { useUIStore } from '@/lib/store'
import { alertsApi } from '@/lib/alertsApi'
import { useEventStreamContext } from '@/contexts/EventStreamContext'
import { LayoutDashboard, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LoadingText } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

// ─── Dashboard Widgets ───────────────────────────────────────────────────────
import { HealthScore } from '@/components/dashboard/HealthScore'
import { EventsTimeline } from '@/components/dashboard/EventsTimeline'
import { BandwidthChart, type BandwidthDevice } from '@/components/dashboard/BandwidthChart'
import { AlertSummary } from '@/components/dashboard/AlertSummary'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { WirelessIssues } from '@/components/dashboard/WirelessIssues'

// ─── Types ───────────────────────────────────────────────────────────────────

type RefreshInterval = 15000 | 30000 | 60000 | false

const REFRESH_OPTIONS: { label: string; value: RefreshInterval }[] = [
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
  { label: 'Off', value: false },
]

// ─── Dashboard Loading ───────────────────────────────────────────────────────

function DashboardLoading() {
  return (
    <div className="py-8 text-center">
      <LoadingText />
    </div>
  )
}

// ─── Needs Attention (inline component) ─────────────────────────────────────

interface AttentionItem {
  id: string
  deviceId: string
  tenantId: string
  hostname: string
  model: string | null
  severity: 'error' | 'warning'
  reason: string
  hasCoords: boolean
}

function NeedsAttention({ devices }: { devices: FleetDevice[] }) {
  const items = useMemo<AttentionItem[]>(() => {
    const result: AttentionItem[] = []

    for (const d of devices) {
      const base = {
        deviceId: d.id,
        tenantId: d.tenant_id,
        hostname: d.hostname,
        model: d.model,
        hasCoords: d.latitude != null && d.longitude != null,
      }

      if (d.status === 'offline') {
        result.push({ ...base, id: `${d.id}-offline`, severity: 'error', reason: 'Offline' })
      } else if (d.status === 'degraded') {
        result.push({ ...base, id: `${d.id}-degraded`, severity: 'warning', reason: 'Degraded' })
      }

      if (d.last_cpu_load != null && d.last_cpu_load > 80) {
        result.push({ ...base, id: `${d.id}-cpu`, severity: 'warning', reason: `CPU ${d.last_cpu_load}%` })
      }
    }

    result.sort((a, b) => {
      if (a.severity === b.severity) return 0
      return a.severity === 'error' ? -1 : 1
    })

    return result.slice(0, 10)
  }, [devices])

  const count = items.length

  return (
    <div className="bg-panel border border-border-default rounded-sm mb-3.5">
      <div className="px-3 py-2 border-b border-border-default bg-elevated">
        <span className="text-[7px] font-medium text-text-muted uppercase tracking-[1.5px]">
          Needs Attention
        </span>
        <span className="text-[7px] text-[hsl(var(--text-label))]"> · </span>
        <span className="text-[7px] text-text-secondary font-mono">{count}</span>
      </div>
      {count > 0 ? (
        <div className="divide-y divide-border-subtle">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-3 py-1.5 border-l-2"
              style={{
                borderLeftColor:
                  item.severity === 'error'
                    ? 'hsl(var(--error))'
                    : 'hsl(var(--warning))',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  to="/tenants/$tenantId/devices/$deviceId"
                  params={{ tenantId: item.tenantId, deviceId: item.deviceId }}
                  className="text-xs text-text-primary font-medium truncate hover:text-accent transition-[color] duration-[50ms]"
                >
                  {item.hostname}
                </Link>
                <span className="text-[10px] text-text-secondary flex-shrink-0">
                  {item.model}
                </span>
                {item.hasCoords && (
                  <Link
                    to="/map"
                    className="text-text-muted hover:text-accent transition-[color] duration-[50ms] flex-shrink-0"
                    title="View on map"
                  >
                    <MapPin className="h-3 w-3" />
                  </Link>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] font-mono font-medium flex-shrink-0 ml-2',
                  item.severity === 'error' ? 'text-error' : 'text-warning',
                )}
              >
                {item.reason}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-5 text-center">
          <span className="text-[9px] text-text-muted">No issues detected</span>
        </div>
      )}
    </div>
  )
}

// ─── Fleet Dashboard ─────────────────────────────────────────────────────────

export function FleetDashboard() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'
  const { selectedTenantId } = useUIStore()
  const tenantId = isSuperAdmin ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // Fetch tenants for super admins to resolve selected org name
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    enabled: !!isSuperAdmin,
  })
  const selectedTenantName = tenants?.find((t) => t.id === selectedTenantId)?.name

  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(30000)

  // ── SSE connection state (disable polling when connected) ────────────────
  const { connectionState } = useEventStreamContext()
  const isSSEConnected = connectionState === 'connected'

  // ── Fleet summary query ──────────────────────────────────────────────────
  const {
    data: fleetDevices,
    isLoading: fleetLoading,
    isFetching: fleetFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['fleet-summary', isSuperAdmin && !selectedTenantId ? 'all' : tenantId],
    queryFn: () =>
      isSuperAdmin && !selectedTenantId
        ? metricsApi.fleetSummaryAll()
        : metricsApi.fleetSummary(tenantId),
    // Disable polling when SSE is connected (events update cache directly)
    refetchInterval: isSSEConnected ? false : refreshInterval,
    enabled: !!user,
  })

  // ── Alerts query (for counts by severity) ────────────────────────────────
  const { data: alertsData } = useQuery({
    queryKey: ['dashboard-alerts', tenantId, 'firing'],
    queryFn: () =>
      alertsApi.getAlerts(tenantId, {
        status: 'firing',
        per_page: 200,
      }),
    // Disable polling when SSE is connected (events invalidate cache)
    refetchInterval: isSSEConnected ? false : refreshInterval,
    enabled: !!user && !isSuperAdmin && !!tenantId,
  })

  // ── Derived data ─────────────────────────────────────────────────────────
  const totalDevices = fleetDevices?.length ?? 0
  const onlineDevices = useMemo(
    () => fleetDevices?.filter((d) => d.status === 'online') ?? [],
    [fleetDevices],
  )
  const degradedCount = useMemo(
    () => fleetDevices?.filter((d) => d.status === 'degraded').length ?? 0,
    [fleetDevices],
  )
  const offlineCount = useMemo(
    () => fleetDevices?.filter((d) => d.status === 'offline').length ?? 0,
    [fleetDevices],
  )

  // Alert counts
  const alerts = alertsData?.items ?? []
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length
  const warningCount = alerts.filter((a) => a.severity === 'warning').length
  const infoCount = alerts.filter((a) => a.severity === 'info').length
  const totalAlerts = criticalCount + warningCount + infoCount

  // Health score device data
  const healthDevices = useMemo(
    () =>
      fleetDevices?.map((d) => ({
        status: d.status,
        last_cpu_load: d.last_cpu_load,
        last_memory_used_pct: d.last_memory_used_pct,
      })) ?? [],
    [fleetDevices],
  )

  // Top resource consumers (using CPU load as proxy for bandwidth)
  // Sort by CPU load descending, take top 10
  const topConsumers: BandwidthDevice[] = useMemo(() => {
    if (!fleetDevices) return []
    return [...fleetDevices]
      .filter((d) => d.status === 'online' && d.last_cpu_load != null)
      .sort((a, b) => (b.last_cpu_load ?? 0) - (a.last_cpu_load ?? 0))
      .slice(0, 10)
      .map((d) => ({
        hostname: d.hostname,
        deviceId: d.id,
        tenantId: d.tenant_id,
        // Use CPU load percentage as the bandwidth metric for visualization
        bandwidthBps: (d.last_cpu_load ?? 0) * 10_000_000, // Scale to make chart readable
      }))
  }, [fleetDevices])

  // Last updated timestamp
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null

  const isRefreshing = fleetFetching && !fleetLoading

  return (
    <div className="space-y-6" data-testid="dashboard">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 pb-2.5 mb-3.5 border-b border-border-default">
        <div>
          <h1 className="text-sm font-semibold text-text-primary">Overview</h1>
          <p className="text-[9px] text-text-muted mt-0.5">
            Fleet overview across{' '}
            {isSuperAdmin
              ? selectedTenantId && selectedTenantName
                ? selectedTenantName
                : 'all tenants'
              : 'your organization'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Refresh indicator */}
          {isRefreshing && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Refreshing
            </span>
          )}
          {/* Last updated */}
          {lastUpdated && !isRefreshing && (
            <span className="text-xs text-text-muted hidden sm:inline">
              Updated {lastUpdated}
            </span>
          )}
          {/* Refresh interval selector */}
          <div className="flex items-center rounded-md border border-border bg-panel">
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setRefreshInterval(opt.value)}
                data-testid={`refresh-${opt.label.toLowerCase()}`}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  'first:rounded-l-md last:rounded-r-md',
                  refreshInterval === opt.value
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-muted hover:text-text-secondary hover:bg-elevated/50',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Dashboard Content ───────────────────────────────────────────── */}
      {fleetLoading ? (
        <DashboardLoading />
      ) : totalDevices === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No fleet data"
          description="Add devices to see your fleet dashboard."
        />
      ) : (
        <>
          {/* Metrics Strip — joined 4-column bar */}
          <div className="flex gap-px mb-3.5 bg-border-default rounded-sm overflow-hidden">
            <div className="flex-1 bg-panel px-3 py-2">
              <div className="text-lg font-medium font-mono text-text-primary">
                {totalDevices}
              </div>
              <div className="text-[7px] text-text-muted uppercase tracking-[1.5px] font-medium mt-0.5">
                Devices
              </div>
            </div>
            <div className="flex-1 bg-panel px-3 py-2">
              <div className="text-lg font-medium font-mono text-success">
                {onlineDevices.length}
              </div>
              <div className="text-[7px] text-text-muted uppercase tracking-[1.5px] font-medium mt-0.5">
                Online
              </div>
            </div>
            <div className="flex-1 bg-panel px-3 py-2">
              <div
                className={cn(
                  'text-lg font-medium font-mono',
                  degradedCount > 0 ? 'text-warning' : 'text-text-primary',
                )}
              >
                {degradedCount}
              </div>
              <div className="text-[7px] text-text-muted uppercase tracking-[1.5px] font-medium mt-0.5">
                Degraded
              </div>
            </div>
            <div className="flex-1 bg-panel px-3 py-2">
              <div
                className={cn(
                  'text-lg font-medium font-mono',
                  offlineCount > 0 ? 'text-error' : 'text-text-primary',
                )}
              >
                {offlineCount}
              </div>
              <div className="text-[7px] text-text-muted uppercase tracking-[1.5px] font-medium mt-0.5">
                Offline
              </div>
            </div>
          </div>

          {/* Needs Attention — full width */}
          <NeedsAttention devices={fleetDevices ?? []} />

          {/* Widget Grid — responsive 3 columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Events Timeline — spans 2 columns on desktop */}
            <div className="lg:col-span-2">
              <EventsTimeline
                tenantId={tenantId}
                isSuperAdmin={isSuperAdmin ?? false}
              />
            </div>

            {/* Right column: Alert Summary + Quick Actions stacked */}
            <div className="space-y-4">
              <AlertSummary
                criticalCount={criticalCount}
                warningCount={warningCount}
                infoCount={infoCount}
                tenantId={tenantId}
              />
              <QuickActions
                tenantId={tenantId}
                isSuperAdmin={isSuperAdmin ?? false}
              />
            </div>

            {/* Bandwidth / Top Resource Consumers — spans 2 columns on desktop */}
            <div className="lg:col-span-2">
              <BandwidthChart devices={topConsumers} />
            </div>

            {/* Health Score */}
            <div>
              <HealthScore
                devices={healthDevices}
                activeAlerts={totalAlerts}
                criticalAlerts={criticalCount}
              />
            </div>

            {/* Wireless Issues */}
            <div>
              <WirelessIssues tenantId={tenantId || null} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
