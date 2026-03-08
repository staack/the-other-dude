import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FleetDashboard } from '@/components/fleet/FleetDashboard'
import { CardGridSkeleton } from '@/components/ui/page-skeleton'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { tenantsApi } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/')({
  component: FleetDashboardPage,
})

function FleetDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Only check for super_admin -- regular users always have a tenant
  const shouldCheck = isSuperAdmin(user)

  const { data: tenants, isLoading: tenantsLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    enabled: shouldCheck,
  })

  // Filter out the System (Internal) tenant — only real customer tenants count
  const realTenants = tenants?.filter(
    (t) => t.id !== '00000000-0000-0000-0000-000000000000',
  )

  useEffect(() => {
    if (shouldCheck && !tenantsLoading && tenants && realTenants && realTenants.length === 0) {
      void navigate({ to: '/setup' })
    }
  }, [shouldCheck, tenantsLoading, tenants, realTenants, navigate])

  // Show skeleton while checking (super_admin only)
  if (shouldCheck && tenantsLoading) {
    return <CardGridSkeleton />
  }

  return <FleetDashboard />
}
