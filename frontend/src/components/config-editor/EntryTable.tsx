/**
 * EntryTable -- displays RouterOS entries at the current menu path
 * in a dynamic table with edit/delete action buttons.
 */

import { Pencil, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { canWrite } from '@/lib/auth'
import { useAuth } from '@/lib/auth'

interface EntryTableProps {
  entries: Record<string, string>[]
  currentPath: string
  isLoading: boolean
  error: string | null
  onEdit: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
  onAdd: () => void
}


export function EntryTable({
  entries,
  currentPath,
  isLoading,
  error,
  onEdit,
  onDelete,
  onAdd,
}: EntryTableProps) {
  const { user } = useAuth()
  const writable = canWrite(user)

  if (error) {
    const isContainerPath =
      error.includes('no such command') ||
      error.includes('502') ||
      error.includes('Failed to browse')
    return (
      <div
        className={cn(
          'rounded-lg border p-4 text-sm',
          isContainerPath
            ? 'border-border bg-surface text-text-secondary'
            : 'border-error/30 bg-error/10 text-error',
        )}
      >
        {isContainerPath ? (
          <>
            <p className="font-medium text-text-primary mb-1">This is a menu category</p>
            <p className="text-xs text-text-muted">
              Select a sub-menu from the tree on the left to view entries. Container paths like{' '}
              <span className="font-mono">{currentPath}</span> group related sub-menus and cannot be
              listed directly.
            </p>
          </>
        ) : (
          error
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-48 bg-elevated/50 rounded animate-pulse" />
          <div className="h-8 w-24 bg-elevated/50 rounded animate-pulse" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-surface rounded animate-pulse" />
        ))}
      </div>
    )
  }

  // Compute visible columns from first entry (hide .id — used internally only)
  const columns =
    entries.length > 0
      ? Object.keys(entries[0])
          .filter((k) => k !== '.id')
          .sort((a, b) => a.localeCompare(b))
      : []

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-text-muted">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} at{' '}
          <span className="text-text-secondary font-mono">{currentPath}</span>
        </div>
        {writable && (
          <Button size="sm" onClick={onAdd} className="h-7 text-xs gap-1">
            <Plus className="h-3 w-3" />
            Add New
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          No entries found at this path
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="text-left px-3 py-2 text-text-secondary font-medium whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
                {writable && (
                  <th className="text-right px-3 py-2 text-text-secondary font-medium w-20">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={entry['.id'] || i}
                  className={cn(
                    'border-b border-border/50 hover:bg-surface transition-colors',
                    entry['dynamic'] === 'true' && 'text-text-muted',
                  )}
                >
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-1.5 whitespace-nowrap font-mono text-text-secondary">
                      {entry[col] ?? ''}
                    </td>
                  ))}
                  {writable && (
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onEdit(entry)}
                          className="p-1 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => onDelete(entry)}
                          className="p-1 rounded hover:bg-error/20 text-text-muted hover:text-error transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
