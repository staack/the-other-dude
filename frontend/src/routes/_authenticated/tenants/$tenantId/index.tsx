import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Users, Monitor, Building2 } from 'lucide-react'
import { tenantsApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { CardGridSkeleton } from '@/components/ui/page-skeleton'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/')({
  component: TenantDetailPage,
})

function TenantDetailPage() {
  const { tenantId } = Route.useParams()

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => tenantsApi.get(tenantId),
  })

  if (isLoading) {
    return <CardGridSkeleton cards={2} />
  }

  if (!tenant) {
    return <div className="text-text-muted text-sm">Tenant not found</div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-elevated flex items-center justify-center flex-shrink-0">
          <Building2 className="h-5 w-5 text-text-secondary" />
        </div>
        <div>
          <h1 className="text-base font-semibold">{tenant.name}</h1>
          {tenant.description && (
            <p className="text-sm text-text-secondary mt-0.5">{tenant.description}</p>
          )}
          <p className="text-xs text-text-muted mt-1">Created {formatDate(tenant.created_at)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link
          to="/tenants/$tenantId/users"
          params={{ tenantId }}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 hover:bg-elevated/50 transition-colors group"
        >
          <Users className="h-8 w-8 text-text-muted group-hover:text-text-muted transition-colors" />
          <div>
            <p className="text-2xl font-semibold">{tenant.user_count}</p>
            <p className="text-xs text-text-secondary">Users</p>
          </div>
        </Link>

        <Link
          to="/tenants/$tenantId/devices"
          params={{ tenantId }}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 hover:bg-elevated/50 transition-colors group"
        >
          <Monitor className="h-8 w-8 text-text-muted group-hover:text-text-muted transition-colors" />
          <div>
            <p className="text-2xl font-semibold">{tenant.device_count}</p>
            <p className="text-xs text-text-secondary">Devices</p>
          </div>
        </Link>
      </div>

      <div className="flex gap-2">
        <Link
          to="/tenants/$tenantId/users"
          params={{ tenantId }}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors underline-offset-2 hover:underline"
        >
          Manage users
        </Link>
        <span className="text-text-muted">·</span>
        <Link
          to="/tenants/$tenantId/devices"
          params={{ tenantId }}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors underline-offset-2 hover:underline"
        >
          View fleet
        </Link>
      </div>
    </div>
  )
}
