import { useEffect, useState } from 'react'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { metricsApi } from '@/lib/api'
import { alertsApi } from '@/lib/alertsApi'
import { operationsPreviewEnabled } from '@/lib/features'
import { OperationsView } from '@/components/operations/OperationsView'

export const Route = createFileRoute('/_authenticated/operations')({
  beforeLoad: () => {
    if (!operationsPreviewEnabled) throw redirect({ to: '/' })
  },
  validateSearch: (search: Record<string, unknown>) => ({
    issue: typeof search.issue === 'string' ? search.issue.slice(0, 200) : '',
  }),
  component: OperationsPage,
})
function OperationsPage() {
  const user = useAuth((s) => s.user)
  const selectedTenant = useUIStore((s) => s.selectedTenantId)
  const tenantId = user?.role === 'super_admin' ? selectedTenant : user?.tenant_id
  // Remount review state when the identity or organization changes.
  if (!tenantId)
    return (
      <div className="p-6">
        <h1 className="text-xl">Operations</h1>
        <p>Select an organization to review its devices and alerts.</p>
      </div>
    )
  return (
    <TenantOperations key={`${user?.id}:${tenantId}`} tenantId={tenantId} userId={user?.id ?? ''} />
  )
}
function TenantOperations({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  // Separate cache: existing fleet SSE updates can synthesize last_seen on a status event.
  const fleet = useQuery({
    queryKey: ['operations-fleet', userId, tenantId],
    queryFn: () => metricsApi.fleetSummary(tenantId),
    refetchInterval: 30_000,
  })
  const alerts = useQuery({
    queryKey: ['dashboard-alerts', tenantId, 'operations', userId],
    queryFn: async () => {
      const [firing, flapping] = await Promise.all([
        alertsApi.getAlerts(tenantId, { status: 'firing', per_page: 200 }),
        alertsApi.getAlerts(tenantId, { status: 'flapping', per_page: 200 }),
      ])
      return {
        items: [...firing.items, ...flapping.items],
        incomplete: firing.total > firing.items.length || flapping.total > flapping.items.length,
      }
    },
    refetchInterval: 30_000,
  })
  if (fleet.isPending && alerts.isPending)
    return (
      <div className="p-6" role="status">
        Loading device and alert evidence…
      </div>
    )
  const incomplete =
    fleet.isError || alerts.isError || !fleet.data || !alerts.data || !!alerts.data?.incomplete
  return (
    <OperationsView
      devices={fleet.data ?? []}
      alerts={alerts.data?.items ?? []}
      now={now}
      updatedAt={fleet.dataUpdatedAt}
      incomplete={incomplete}
      incompleteReason={
        fleet.isPending
          ? 'Fleet evidence is still loading.'
          : alerts.isPending
            ? 'Alert evidence is still loading.'
            : fleet.isError
              ? 'Fleet evidence could not be refreshed.'
              : alerts.isError
                ? 'Alert evidence could not be refreshed.'
                : alerts.data?.incomplete
                  ? 'Only the first 200 firing and 200 flapping alerts are included. Review Alerts for the complete list.'
                  : undefined
      }
      renderLink={(href, label, className) => {
        const [to, query] = href.split('?')
        return <Link to={to} search={query ? { issue: new URLSearchParams(query).get('issue') ?? '' } : undefined} className={className}>{label}</Link>
      }}
      refreshing={fleet.isFetching || alerts.isFetching}
      selected={search.issue}
      onSelect={(issue) => {
        void navigate({ search: { issue }, replace: true, resetScroll: false })
      }}
      onRefresh={() => {
        void fleet.refetch()
        void alerts.refetch()
      }}
      deviceHref={(id, issue) =>
        `/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(id)}?issue=${encodeURIComponent(issue ?? '')}`
      }
      fleetHref={`/tenants/${encodeURIComponent(tenantId)}/devices`}
    />
  )
}
