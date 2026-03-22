import { createFileRoute } from '@tanstack/react-router'
import { ShieldAlert, Building2 } from 'lucide-react'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { CredentialProfilesPage } from '@/components/settings/CredentialProfilesPage'

export const Route = createFileRoute('/_authenticated/settings/credentials')({
  component: CredentialProfilesRoute,
})

function CredentialProfilesRoute() {
  const { user } = useAuth()
  const { selectedTenantId } = useUIStore()

  const tenantId = isSuperAdmin(user) ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  // RBAC: only tenant_admin+ can manage credential profiles
  if (!isTenantAdmin(user)) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="rounded-lg border border-border bg-panel px-6 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <h2 className="text-sm font-medium mb-1">Access Denied</h2>
          <p className="text-sm text-text-muted">
            You need tenant admin or higher permissions to manage credential profiles.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {!tenantId ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-center space-y-2">
          <Building2 className="h-6 w-6 mx-auto text-text-muted" />
          <p className="text-sm text-text-muted">
            Select an organization from the sidebar to manage credential profiles.
          </p>
        </div>
      ) : (
        <CredentialProfilesPage tenantId={tenantId} />
      )}
    </div>
  )
}
