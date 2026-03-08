/**
 * Maintenance Windows page route -- /_authenticated/maintenance
 *
 * Allows operators to schedule maintenance windows with alert suppression.
 * Shows active, upcoming, and past windows in a timeline layout.
 * Requires at least operator role.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Building2, Calendar, ChevronRight } from 'lucide-react'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { MaintenanceList } from '@/components/maintenance/MaintenanceList'

export const Route = createFileRoute('/_authenticated/maintenance')({
  component: MaintenancePage,
})

function MaintenancePage() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: require at least operator role
  if (!canWrite(user)) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-text-muted" />
          Maintenance Windows
        </h1>
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-muted">
            You need at least operator permissions to manage maintenance windows.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <span>Home</span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">Maintenance</span>
      </div>

      {/* Title + tenant selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-text-muted" />
          Maintenance Windows
        </h1>

      </div>

      {/* Main content */}
      {tenantId ? (
        <MaintenanceList tenantId={tenantId} />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="h-10 w-10 text-text-muted mb-3" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to view maintenance windows.
          </p>
        </div>
      )}
    </div>
  )
}
