/**
 * Reports page route -- /_authenticated/reports
 *
 * Allows operators to generate and download device inventory,
 * metrics summary, alert history, and change log reports.
 * Uses the global org selector in the header for tenant context.
 * Requires at least operator role.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Building2, FileText, ChevronRight } from 'lucide-react'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { ReportsPage } from '@/components/reports/ReportsPage'

export const Route = createFileRoute('/_authenticated/reports')({
  component: ReportsPageRoute,
})

function ReportsPageRoute() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: require at least operator role
  if (!canWrite(user)) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5 text-text-muted" />
          Reports
        </h1>
        <div className="rounded-lg border border-border bg-panel p-8 text-center">
          <p className="text-sm text-text-muted">
            You need at least operator permissions to generate reports.
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
        <span className="text-text-secondary">Reports</span>
      </div>

      {/* Title */}
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <FileText className="h-5 w-5 text-text-muted" />
        Reports
      </h1>

      {/* Reports panel */}
      {tenantId ? (
        <ReportsPage tenantId={tenantId} />
      ) : (
        <div className="rounded-lg border border-border bg-panel p-12 text-center">
          <Building2 className="h-8 w-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to view reports.
          </p>
        </div>
      )}
    </div>
  )
}
