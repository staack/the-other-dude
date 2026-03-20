import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { metricsApi, tenantsApi } from '@/lib/api'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { Skeleton } from '@/components/ui/skeleton'
import { FleetMap } from './FleetMap'

export function MapPage() {
  const { user } = useAuth()
  const superAdmin = isSuperAdmin(user)
  const [selectedTenant, setSelectedTenant] = useState<string>('all')

  // Fetch devices -- super_admin gets cross-tenant, others get their own tenant
  const {
    data: devices,
    isLoading: devicesLoading,
    error: devicesError,
  } = useQuery({
    queryKey: ['fleet-map', superAdmin ? 'all' : user?.tenant_id],
    queryFn: () =>
      superAdmin
        ? metricsApi.fleetSummaryAll()
        : metricsApi.fleetSummary(user!.tenant_id!),
    enabled: !!user && (superAdmin || !!user.tenant_id),
  })

  // Fetch tenant list for super_admin filter dropdown
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    enabled: superAdmin,
  })

  // Filter devices by selected tenant
  const filteredDevices = useMemo(() => {
    if (!devices) return []
    if (selectedTenant === 'all') return devices
    return devices.filter((d) => d.tenant_id === selectedTenant)
  }, [devices, selectedTenant])

  // Count mapped vs total
  const totalDevices = filteredDevices.length
  const mappedDevices = filteredDevices.filter(
    (d) => d.latitude != null && d.longitude != null,
  ).length

  // Determine effective tenantId for links in markers
  const effectiveTenantId = useMemo(() => {
    if (!superAdmin) return user?.tenant_id ?? ''
    if (selectedTenant !== 'all') return selectedTenant
    // For "all" view as super_admin, we pass the device's own tenant_id from the FleetDevice record
    // The FleetMap component handles this per-device
    return ''
  }, [superAdmin, selectedTenant, user])

  if (devicesLoading) {
    return <Skeleton className="h-[calc(100vh-8rem)] w-full rounded-lg" />
  }

  if (devicesError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <MapPin className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary text-sm">Failed to load fleet data</p>
          <p className="text-text-muted text-xs mt-1">
            {devicesError instanceof Error ? devicesError.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 6rem)' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-sidebar shrink-0">
        <div className="flex items-center gap-3">
          <MapPin className="h-4 w-4 text-text-secondary" />
          <h1 className="text-sm font-medium text-text-primary">Fleet Map</h1>
          <span className="text-xs text-text-muted">
            {mappedDevices} of {totalDevices} device{totalDevices !== 1 ? 's' : ''} mapped
          </span>
        </div>

        {superAdmin && tenants && tenants.length > 0 && (
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="text-xs bg-elevated/50 border border-border text-text-primary rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-border-bright"
          >
            <option value="all">All Organizations</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {totalDevices === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MapPin className="h-10 w-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary text-sm">No devices found</p>
              <p className="text-text-muted text-xs mt-1">
                Add devices with coordinates to see them on the map
              </p>
            </div>
          </div>
        ) : mappedDevices === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MapPin className="h-10 w-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary text-sm">No devices have coordinates</p>
              <p className="text-text-muted text-xs mt-1">
                Edit devices and add latitude/longitude to place them on the map
              </p>
            </div>
          </div>
        ) : (
          <FleetMapWithTenantRouting
            devices={filteredDevices}
            effectiveTenantId={effectiveTenantId}
            superAdmin={superAdmin}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Wrapper that handles tenant routing for markers.
 * In super_admin "all" mode, each device marker uses its own tenant_id.
 * Otherwise, the effective tenant is used for all markers.
 */
function FleetMapWithTenantRouting({
  devices,
  effectiveTenantId,
  superAdmin,
}: {
  devices: Array<{ latitude: number | null; longitude: number | null; tenant_id: string } & Record<string, unknown>>
  effectiveTenantId: string
  superAdmin: boolean
}) {
  // For super_admin "all" view we need per-device tenant routing
  // FleetMap + DeviceMarker handle this by using device.tenant_id when tenantId is empty
  const tenantId = superAdmin && !effectiveTenantId ? '' : effectiveTenantId

  return (
    <FleetMap
      devices={devices as unknown as import('@/lib/api').FleetDevice[]}
      tenantId={tenantId}
    />
  )
}
