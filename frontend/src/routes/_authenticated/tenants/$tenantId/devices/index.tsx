import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Plus, Scan, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { tenantsApi } from '@/lib/api'
import { useAuth, canWrite } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { FleetTable } from '@/components/fleet/FleetTable'
import { DeviceFilters } from '@/components/fleet/DeviceFilters'
import { AddDeviceForm } from '@/components/fleet/AddDeviceForm'

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  add: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/devices/')({
  validateSearch: searchSchema,
  component: DevicesPage,
})

function DevicesPage() {
  const { tenantId } = Route.useParams()
  const search = Route.useSearch()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(search.add === 'true')

  // Open dialog when ?add=true is set (e.g. from empty state button)
  useEffect(() => {
    if (search.add === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAddOpen(true)
      // Clear the search param so it doesn't re-open on navigation
      void navigate({
        to: '/tenants/$tenantId/devices',
        params: { tenantId },
        search: { ...search, add: undefined },
        replace: true,
      })
    }
  }, [search.add])

  const { data: tenant } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => tenantsApi.get(tenantId),
  })

  return (
    <div className="space-y-3">
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
        <span className="text-text-secondary">Devices</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <DeviceFilters tenantId={tenantId} />
        {canWrite(user) && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link to="/tenants/$tenantId/devices/scan" params={{ tenantId }}>
              <Button variant="outline" size="sm">
                <Scan className="h-3.5 w-3.5" />
                Scan Subnet
              </Button>
            </Link>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Device
            </Button>
          </div>
        )}
      </div>

      <FleetTable
        tenantId={tenantId}
        search={search.search}
        status={search.status}
        sortBy={search.sort_by}
        sortDir={search.sort_dir}
        page={search.page}
        pageSize={search.page_size}
      />

      <AddDeviceForm tenantId={tenantId} open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
