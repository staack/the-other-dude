/**
 * Audit Trail page route -- /_authenticated/audit
 *
 * Displays a centralized, filterable audit log for MSP accountability.
 * Uses the global org selector in the header for tenant context.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Building2, ClipboardList } from 'lucide-react'
import { useAuth, isSuperAdmin, isOperator } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { AuditLogTable } from '@/components/audit/AuditLogTable'

export const Route = createFileRoute('/_authenticated/audit')({
  component: AuditPage,
})

function AuditPage() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: require at least operator role
  if (!isOperator(user)) {
    return (
      <div className="max-w-6xl space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-text-muted" />
          Audit Trail
        </h1>
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-muted">
            You need at least operator permissions to view the audit trail.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl space-y-4">
      {/* Title */}
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-text-muted" />
        Audit Trail
      </h1>

      {/* Audit log table or empty state */}
      {tenantId ? (
        <AuditLogTable tenantId={tenantId} />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-12 text-center">
          <Building2 className="h-8 w-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to view audit logs.
          </p>
        </div>
      )}
    </div>
  )
}
