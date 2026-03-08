import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserX } from 'lucide-react'
import { usersApi } from '@/lib/api'
import { useAuth, isTenantAdmin } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import { CreateUserForm } from './CreateUserForm'
import { toast } from '@/components/ui/toast'
import { TableSkeleton } from '@/components/ui/page-skeleton'

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#7c3aed',
  tenant_admin: '#2563eb',
  operator: '#059669',
  viewer: '#6b7280',
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
}

interface Props {
  tenantId: string
}

export function UserList({ tenantId }: Props) {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', tenantId],
    queryFn: () => usersApi.list(tenantId),
  })

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => usersApi.deactivate(tenantId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: 'User deactivated' })
    },
    onError: () => {
      toast({ title: 'Failed to deactivate user', variant: 'destructive' })
    },
  })

  const handleDeactivate = (userId: string, email: string) => {
    if (confirm(`Deactivate user "${email}"?`)) {
      deactivateMutation.mutate(userId)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Users</h2>
          <p className="text-xs text-text-muted mt-0.5">
            {users?.filter((u) => u.is_active).length ?? 0} active
          </p>
        </div>
        {isTenantAdmin(currentUser) && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add User
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Name</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Email</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Role</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Last Login</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Status</th>
              {isTenantAdmin(currentUser) && (
                <th className="px-3 py-2 text-xs font-medium text-text-muted w-8"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4">
                  <TableSkeleton rows={5} />
                </td>
              </tr>
            ) : users?.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-muted">
                  No users in this tenant
                </td>
              </tr>
            ) : (
              users?.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border/50 hover:bg-surface transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium">{u.name}</td>
                  <td className="px-3 py-2.5 text-text-secondary">{u.email}</td>
                  <td className="px-3 py-2.5">
                    <Badge color={ROLE_COLORS[u.role]}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-text-muted text-xs">
                    {formatDateTime(u.last_login)}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.is_active ? (
                      <span className="text-xs text-success">Active</span>
                    ) : (
                      <span className="text-xs text-text-muted">Inactive</span>
                    )}
                  </td>
                  {isTenantAdmin(currentUser) && (
                    <td className="px-3 py-2.5">
                      {u.is_active && u.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDeactivate(u.id, u.email)}
                          className="text-text-muted hover:text-error transition-colors"
                          title="Deactivate user"
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateUserForm
        tenantId={tenantId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
