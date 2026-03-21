import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { metricsApi, tenantsApi } from '@/lib/api'
import { useUIStore } from '@/lib/store'
import { alertsApi } from '@/lib/alertsApi'
import { useEventStreamContext } from '@/contexts/EventStreamContext'
import { LayoutDashboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

// ─── Dashboard Widgets ───────────────────────────────────────────────────────
import { KpiCards } from '@/components/dashboard/KpiCards'
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

// ─── Dashboard Skeleton ──────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      {/* KPI cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <Skeleton className="h-3 w-24 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      {/* Widget grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border border-border p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="rounded-lg border border-border p-4 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="lg:col-span-2 rounded-lg border border-border p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="rounded-lg border border-border p-4 space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
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
    queryKey: ['fleet-summary', isSuperAdmin ? 'all' : tenantId],
    queryFn: () =>
      isSuperAdmin
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
  const onlinePercent =
    totalDevices > 0 ? (onlineDevices.length / totalDevices) * 100 : 0

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

  // Total "bandwidth" (sum of CPU loads scaled)
  const totalBandwidthBps = useMemo(
    () => topConsumers.reduce((sum, d) => sum + d.bandwidthBps, 0),
    [topConsumers],
  )

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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-text-muted mt-0.5">
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
                    ? 'bg-accent/15 text-accent'
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
        <DashboardSkeleton />
      ) : totalDevices === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No fleet data"
          description="Add devices to see your fleet dashboard."
        />
      ) : (
        <>
          {/* KPI Cards — full width, 4 columns */}
          <KpiCards
            totalDevices={totalDevices}
            onlinePercent={onlinePercent}
            activeAlerts={totalAlerts}
            totalBandwidthBps={totalBandwidthBps}
          />

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
