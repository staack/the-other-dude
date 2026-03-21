import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronUp, ChevronDown, ChevronsUpDown, MapPin, Pencil, Trash2 } from 'lucide-react'
import { sitesApi, type SiteResponse } from '@/lib/api'
import { useAuth, canWrite } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

interface SiteTableProps {
  tenantId: string
  search: string
  onCreateClick: () => void
  onEditClick: (site: SiteResponse) => void
}

type SortField = 'name' | 'device_count' | 'online_percent'
type SortDir = 'asc' | 'desc'

interface SortHeaderProps {
  column: SortField
  label: string
  currentSort: SortField
  currentDir: SortDir
  onSort: (col: SortField) => void
  className?: string
}

function SortHeader({ column, label, currentSort, currentDir, onSort, className }: SortHeaderProps) {
  const isActive = currentSort === column
  const ariaSortValue: 'ascending' | 'descending' | 'none' = isActive
    ? (currentDir === 'asc' ? 'ascending' : 'descending')
    : 'none'

  return (
    <th
      scope="col"
      className={cn('px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted', className)}
      aria-sort={ariaSortValue}
    >
      <button
        className="flex items-center gap-1 hover:text-text-primary transition-colors group"
        onClick={() => onSort(column)}
      >
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ChevronUp className="h-3 w-3 text-text-secondary" />
          ) : (
            <ChevronDown className="h-3 w-3 text-text-secondary" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 text-text-muted group-hover:text-text-secondary" />
        )}
      </button>
    </th>
  )
}

export function SiteTable({ tenantId, search, onCreateClick, onEditClick }: SiteTableProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const showActions = canWrite(user)

  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [deleteTarget, setDeleteTarget] = useState<SiteResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['sites', tenantId],
    queryFn: () => sitesApi.list(tenantId),
  })

  const deleteMutation = useMutation({
    mutationFn: (siteId: string) => sitesApi.delete(tenantId, siteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sites', tenantId] })
      setDeleteTarget(null)
    },
  })

  function handleSort(col: SortField) {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  if (isLoading) {
    return <TableSkeleton />
  }

  if (!data || data.sites.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="No sites yet"
        description="Create a site to organize your devices by physical location."
        action={{ label: 'Create Site', onClick: onCreateClick }}
      />
    )
  }

  // Filter by search
  const filtered = data.sites.filter((site) =>
    site.name.toLowerCase().includes(search.toLowerCase()),
  )

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'name') return a.name.localeCompare(b.name) * dir
    if (sortBy === 'device_count') return (a.device_count - b.device_count) * dir
    if (sortBy === 'online_percent') return (a.online_percent - b.online_percent) * dir
    return 0
  })

  const sortProps = { currentSort: sortBy, currentDir: sortDir, onSort: handleSort }
  const colCount = showActions ? 6 : 5

  return (
    <>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <SortHeader column="name" label="Name" {...sortProps} className="text-left" />
                <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">
                  Address
                </th>
                <SortHeader column="device_count" label="Devices" {...sortProps} className="text-right" />
                <SortHeader column="online_percent" label="Online %" {...sortProps} className="text-right" />
                <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                  Alerts
                </th>
                {showActions && (
                  <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((site) => (
                <tr
                  key={site.id}
                  className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
                >
                  <td className="px-2 py-1.5">
                    <Link
                      to="/tenants/$tenantId/sites/$siteId"
                      params={{ tenantId, siteId: site.id }}
                      className="font-medium text-text-primary hover:text-accent transition-colors"
                    >
                      {site.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-text-secondary truncate max-w-[200px]">
                    {site.address ?? '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {site.device_count}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span
                      className={cn(
                        'font-medium',
                        site.device_count === 0
                          ? 'text-text-muted'
                          : site.online_percent >= 90
                            ? 'text-green-500'
                            : site.online_percent >= 50
                              ? 'text-yellow-500'
                              : 'text-red-500',
                      )}
                    >
                      {site.device_count > 0 ? `${site.online_percent.toFixed(0)}%` : '--'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {site.alert_count > 0 ? (
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium border border-red-500/40 bg-red-500/10 text-red-500">
                        {site.alert_count}
                      </span>
                    ) : (
                      <span className="text-text-muted">0</span>
                    )}
                  </td>
                  {showActions && (
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEditClick(site)}
                          title="Edit site"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(site)}
                          title="Delete site"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-error" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}

              {/* Unassigned devices row */}
              <tr className="bg-elevated/30">
                <td className="px-2 py-1.5 text-text-muted italic" colSpan={2}>
                  Unassigned
                </td>
                <td className="px-2 py-1.5 text-right text-text-muted">
                  {data.unassigned_count}
                </td>
                <td className="px-2 py-1.5" colSpan={colCount - 3} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete site?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?{' '}
              {deleteTarget?.device_count ?? 0} device(s) will become unassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
