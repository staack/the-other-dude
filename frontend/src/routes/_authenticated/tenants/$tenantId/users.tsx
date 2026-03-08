import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { tenantsApi } from '@/lib/api'
import { UserList } from '@/components/users/UserList'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/users')({
  component: UsersPage,
})

function UsersPage() {
  const { tenantId } = Route.useParams()

  const { data: tenant } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => tenantsApi.get(tenantId),
  })

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <Link to="/tenants" className="hover:text-text-secondary transition-colors">
          Tenants
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link
          to="/tenants/$tenantId"
          params={{ tenantId }}
          className="hover:text-text-secondary transition-colors"
        >
          {tenant?.name ?? tenantId}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">Users</span>
      </div>

      <UserList tenantId={tenantId} />
    </div>
  )
}
