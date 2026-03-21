/**
 * Batch Configuration page route -- /_authenticated/batch-config
 *
 * Allows operators to apply the same configuration change to multiple
 * devices at once using a 3-step wizard. Requires at least operator role.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Wrench, ChevronRight, Building2 } from 'lucide-react'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { BatchConfigPanel } from '@/components/config/BatchConfigPanel'

export const Route = createFileRoute('/_authenticated/batch-config')({
  component: BatchConfigPage,
})

function BatchConfigPage() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)
  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: require at least operator role
  if (!canWrite(user)) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="h-5 w-5 text-text-muted" />
          Batch Configuration
        </h1>
        <div className="rounded-lg border border-border bg-panel p-8 text-center">
          <p className="text-sm text-text-muted">
            You need at least operator permissions to use batch configuration.
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
        <span className="text-text-secondary">Batch Config</span>
      </div>

      {/* Title */}
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <Wrench className="h-5 w-5 text-text-muted" />
        Batch Configuration
      </h1>

      {/* Panel */}
      {tenantId ? (
        <BatchConfigPanel tenantId={tenantId} />
      ) : (
        <div className="rounded-lg border border-border bg-panel p-8 text-center space-y-2">
          <Building2 className="h-6 w-6 mx-auto text-text-muted" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to get started.
          </p>
        </div>
      )}
    </div>
  )
}
