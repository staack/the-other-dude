/**
 * Data Transparency page route -- /_authenticated/transparency
 *
 * Displays a filterable timeline of every KMS credential access event.
 * Uses the global org selector in the header for tenant context.
 * Admin-only access (tenant_admin, super_admin).
 *
 * Phase 31 -- TRUST-01, TRUST-02
 */

import { createFileRoute } from '@tanstack/react-router'
import { Building2, Eye } from 'lucide-react'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { TransparencyLogTable } from '@/components/transparency/TransparencyLogTable'

export const Route = createFileRoute('/_authenticated/transparency')({
  component: TransparencyPage,
})

function TransparencyPage() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)
  const isAdmin = isTenantAdmin(user)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: require at least admin role (tenant_admin or super_admin)
  if (!isAdmin) {
    return (
      <div className="max-w-6xl space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Eye className="h-5 w-5 text-text-muted" />
          Data Transparency
        </h1>
        <div className="rounded-lg border border-border bg-panel p-8 text-center">
          <p className="text-sm text-text-muted">
            You need admin permissions to view the transparency dashboard.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl space-y-4">
      {/* Title */}
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Eye className="h-5 w-5 text-text-muted" />
          Data Transparency
        </h1>
        <p className="text-sm text-text-muted mt-0.5">
          Track every credential access event across your devices
        </p>
      </div>

      {/* Transparency log table or empty state */}
      {tenantId ? (
        <TransparencyLogTable tenantId={tenantId} />
      ) : (
        <div className="rounded-lg border border-border bg-panel p-12 text-center">
          <Building2 className="h-8 w-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to view transparency logs.
          </p>
        </div>
      )}
    </div>
  )
}
