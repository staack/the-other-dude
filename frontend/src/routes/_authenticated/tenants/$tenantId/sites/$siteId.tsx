import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { sitesApi } from '@/lib/api'
import { MapPin, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/sites/$siteId')({
  component: SiteDetailPage,
})

function SiteDetailPage() {
  const { tenantId, siteId } = Route.useParams()

  const { data: site, isLoading } = useQuery({
    queryKey: ['sites', tenantId, siteId],
    queryFn: () => sitesApi.get(tenantId, siteId),
  })

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-48 bg-elevated rounded" />
        <div className="h-4 w-64 bg-elevated rounded" />
      </div>
    )
  }

  if (!site) {
    return <div className="text-text-muted">Site not found</div>
  }

  return (
    <div className="space-y-6">
      {/* Header with back link */}
      <div className="flex items-center gap-3">
        <Link to="/tenants/$tenantId/sites" params={{ tenantId }}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Sites
          </Button>
        </Link>
      </div>

      {/* Site info card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center gap-3">
          <MapPin className="h-6 w-6 text-text-muted" />
          <h1 className="text-xl font-semibold">{site.name}</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {site.address && (
            <div>
              <span className="text-text-muted">Address:</span>
              <span className="ml-2 text-text-primary">{site.address}</span>
            </div>
          )}
          {site.latitude != null && site.longitude != null && (
            <div>
              <span className="text-text-muted">Coordinates:</span>
              <span className="ml-2 text-text-primary">
                {site.latitude}, {site.longitude}
              </span>
            </div>
          )}
          {site.elevation != null && (
            <div>
              <span className="text-text-muted">Elevation:</span>
              <span className="ml-2 text-text-primary">{site.elevation} m</span>
            </div>
          )}
          {site.notes && (
            <div className="col-span-full">
              <span className="text-text-muted">Notes:</span>
              <p className="mt-1 text-text-secondary">{site.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Health stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold">{site.device_count}</p>
          <p className="text-xs text-text-muted">Devices</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold">{site.online_count}</p>
          <p className="text-xs text-text-muted">Online</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p
            className={cn(
              'text-2xl font-semibold',
              site.online_percent >= 90
                ? 'text-green-500'
                : site.online_percent >= 50
                  ? 'text-yellow-500'
                  : 'text-red-500',
            )}
          >
            {site.online_percent.toFixed(0)}%
          </p>
          <p className="text-xs text-text-muted">Online %</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className={cn('text-2xl font-semibold', site.alert_count > 0 && 'text-red-500')}>
            {site.alert_count}
          </p>
          <p className="text-xs text-text-muted">Alerts</p>
        </div>
      </div>

      {/* Placeholder for device list -- Phase 14 will add full site dashboard */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold mb-2">Assigned Devices</h2>
        <p className="text-sm text-text-muted">
          {site.device_count > 0
            ? `${site.device_count} device${site.device_count !== 1 ? 's' : ''} assigned to this site. Full device list coming in site dashboard.`
            : 'No devices assigned to this site yet. Assign devices from the fleet page.'}
        </p>
      </div>
    </div>
  )
}
