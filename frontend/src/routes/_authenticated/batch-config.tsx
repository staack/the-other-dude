/**
 * Batch Configuration page route -- /_authenticated/batch-config
 *
 * Allows operators to apply the same configuration change to multiple
 * devices at once using a 3-step wizard. Requires at least operator role.
 *
 * DELIBERATELY NOT LINKED FROM THE UI -- this is not an oversight.
 *
 * BatchConfigPanel pushes through configEditorApi (see BatchConfigPanel.tsx
 * and lib/configEditorApi.ts), which is the one config surface with NO
 * automatic rollback of any kind. This page multiplies that across a whole
 * fleet in one action, so a sidebar entry would offer a one-click way to
 * break every selected device with no safety net. Phase 21's "reachable
 * through the UI, or deliberately not" criterion is answered here with
 * "deliberately not".
 *
 * It is worse than unrevertable, because it does not stop. The execution loop
 * catches each device's failure and continues to the next one
 * (BatchConfigPanel.tsx:805-815 -- no break, nothing rethrown), unlike
 * template rollout, which halts at the first failure. So a change that severs
 * the management path does not fail once and stop; it reaches every device in
 * the selection, and is reverted on none of them.
 *
 * What unblocks linking it: the config editor gaining safe mode, which means
 * moving it off the RouterOS binary API onto SSH. See
 * backend/app/services/safe_mode.py and the roadmap input on that transport
 * change. When that lands, delete this note and add the sidebar entry.
 *
 * Until then the page stays reachable by URL for operators who need it, and
 * says plainly on arrival that changes here cannot be auto-reverted.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Wrench, ChevronRight, Building2, AlertTriangle } from 'lucide-react'
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

      {/* Batch changes go through the config editor, which has no automatic
          rollback. Nobody should arrive here unaware of that. */}
      <div className="flex gap-2.5 rounded-lg border border-warning/50 bg-warning/10 p-3">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Changes made here cannot be rolled back automatically
          </p>
          <p className="text-xs text-text-secondary">
            Batch configuration applies directly to every device you select,
            with no automatic revert if a change goes wrong. It also does not
            stop on failure -- a device that breaks is recorded and the run
            continues to the next one, so a bad change reaches the whole
            selection. Back up the devices first, and try the change on a
            single device before running it across a fleet.
          </p>
        </div>
      </div>

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
