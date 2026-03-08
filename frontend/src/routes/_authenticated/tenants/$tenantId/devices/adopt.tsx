/**
 * Device Adoption page route -- /_authenticated/tenants/$tenantId/devices/adopt
 *
 * 5-step wizard for discovering, configuring, and importing MikroTik devices.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { tenantsApi } from '@/lib/api'
import { AdoptionWizard } from '@/components/fleet/AdoptionWizard'

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantId/devices/adopt',
)({
  component: AdoptPage,
})

function AdoptPage() {
  const { tenantId } = Route.useParams()

  const { data: tenant } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => tenantsApi.get(tenantId),
  })

  return (
    <div className="space-y-4 max-w-3xl">
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
        <Link
          to="/tenants/$tenantId/devices"
          params={{ tenantId }}
          className="hover:text-text-secondary transition-colors"
        >
          Devices
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">Adopt Devices</span>
      </div>

      <h1 className="text-lg font-semibold">Adopt Devices</h1>

      <AdoptionWizard tenantId={tenantId} />
    </div>
  )
}
