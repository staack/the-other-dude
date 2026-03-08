/**
 * Bulk Commands page route -- /_authenticated/bulk-commands
 *
 * Allows operators to execute a RouterOS CLI command across multiple
 * devices at once using a 3-step wizard. Requires at least operator role.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Building2, Terminal, ChevronRight } from 'lucide-react'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { BulkCommandWizard } from '@/components/operations/BulkCommandWizard'

export const Route = createFileRoute('/_authenticated/bulk-commands')({
  component: BulkCommandsPage,
})

function BulkCommandsPage() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: require at least operator role
  if (!canWrite(user)) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Terminal className="h-5 w-5 text-text-muted" />
          Bulk Commands
        </h1>
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-muted">
            You need at least operator permissions to use bulk commands.
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
        <span className="text-text-secondary">Bulk Commands</span>
      </div>

      {/* Title + tenant selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Terminal className="h-5 w-5 text-text-muted" />
          Bulk Commands
        </h1>

      </div>

      {/* Panel */}
      {tenantId ? (
        <BulkCommandWizard tenantId={tenantId} />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="h-10 w-10 text-text-muted mb-3" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to view bulk commands.
          </p>
        </div>
      )}
    </div>
  )
}
