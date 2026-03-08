import { createFileRoute } from '@tanstack/react-router'
import { ShieldAlert, Building2 } from 'lucide-react'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { ApiKeysPage } from '@/components/settings/ApiKeysPage'

export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  component: ApiKeysRoute,
})

function ApiKeysRoute() {
  const { user } = useAuth()
  const { selectedTenantId } = useUIStore()

  const tenantId = isSuperAdmin(user) ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: only tenant_admin+ can manage API keys
  if (!isTenantAdmin(user)) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <h2 className="text-sm font-medium mb-1">Access Denied</h2>
          <p className="text-sm text-text-muted">
            You need tenant admin or higher permissions to manage API keys.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {!tenantId ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center space-y-2">
          <Building2 className="h-6 w-6 mx-auto text-text-muted" />
          <p className="text-sm text-text-muted">
            Select an organization from the header to manage API keys.
          </p>
        </div>
      ) : (
        <ApiKeysPage tenantId={tenantId} />
      )}
    </div>
  )
}
