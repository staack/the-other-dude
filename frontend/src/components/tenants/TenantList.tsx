import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, Building2, Users, Monitor, Trash2 } from 'lucide-react'
import { tenantsApi } from '@/lib/api'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { CreateTenantForm } from './CreateTenantForm'
import { toast } from '@/components/ui/toast'
import { TableSkeleton } from '@/components/ui/page-skeleton'

export function TenantList() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    select: (data) => data.filter((t) => t.id !== SYSTEM_TENANT_ID),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tenantsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: 'Organization deleted' })
    },
    onError: () => {
      toast({ title: 'Failed to delete organization', variant: 'destructive' })
    },
  })

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete organization "${name}"? This will permanently delete all users and devices.`)) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Organizations</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {tenants?.length ?? 0} organization{tenants?.length !== 1 ? 's' : ''}
          </p>
        </div>
        {isSuperAdmin(user) && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Organization
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-panel">
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Name</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-text-muted">Users</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-text-muted">Devices</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Created</th>
              {isSuperAdmin(user) && (
                <th className="px-3 py-2 text-xs font-medium text-text-muted w-8"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-4">
                  <TableSkeleton rows={5} />
                </td>
              </tr>
            ) : tenants?.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-text-muted text-sm">
                  No organizations yet
                </td>
              </tr>
            ) : (
              tenants?.map((tenant) => (
                <tr
                  key={tenant.id}
                  className="border-b border-border/50 hover:bg-panel transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <Link
                      to="/tenants/$tenantId"
                      params={{ tenantId: tenant.id }}
                      className="flex items-center gap-2 hover:text-text-primary transition-colors group"
                    >
                      <Building2 className="h-3.5 w-3.5 text-text-muted group-hover:text-text-secondary" />
                      <span className="font-medium">{tenant.name}</span>
                    </Link>
                    {tenant.contact_email && (
                      <div className="text-xs text-text-muted mt-0.5 ml-5.5 pl-0">
                        {tenant.contact_email}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      to="/tenants/$tenantId/users"
                      params={{ tenantId: tenant.id }}
                      className="flex items-center justify-end gap-1 text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Users className="h-3 w-3" />
                      <span>{tenant.user_count}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      to="/tenants/$tenantId/devices"
                      params={{ tenantId: tenant.id }}
                      className="flex items-center justify-end gap-1 text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Monitor className="h-3 w-3" />
                      <span>{tenant.device_count}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-text-muted text-xs">
                    {formatDate(tenant.created_at)}
                  </td>
                  {isSuperAdmin(user) && (
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleDelete(tenant.id, tenant.name)}
                        className="text-text-muted hover:text-error transition-colors"
                        title="Delete organization"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateTenantForm open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
