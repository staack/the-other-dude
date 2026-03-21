/**
 * Filterable, paginated audit log table with expandable row details and CSV export.
 *
 * Uses TanStack Query for data fetching and design system tokens for styling.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Search,
  ClipboardList,
} from 'lucide-react'
import {
  auditLogsApi,
  type AuditLogEntry,
  type AuditLogParams,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { DeviceLink } from '@/components/ui/device-link'
import { EmptyState } from '@/components/ui/empty-state'

// Predefined action types for the filter dropdown
const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'device_create', label: 'Device Create' },
  { value: 'device_update', label: 'Device Update' },
  { value: 'device_delete', label: 'Device Delete' },
  { value: 'config_browse', label: 'Config Browse' },
  { value: 'config_add', label: 'Config Add' },
  { value: 'config_set', label: 'Config Set' },
  { value: 'config_remove', label: 'Config Remove' },
  { value: 'config_execute', label: 'Config Execute' },
  { value: 'firmware_upgrade', label: 'Firmware Upgrade' },
  { value: 'alert_rule_create', label: 'Alert Rule Create' },
  { value: 'alert_rule_update', label: 'Alert Rule Update' },
  { value: 'bulk_command', label: 'Bulk Command' },
  { value: 'device_adopt', label: 'Device Adopt' },
] as const

const PER_PAGE_OPTIONS = [25, 50, 100] as const

/** Formats an ISO timestamp into a human-readable relative time string. */
function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then

  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

/** Maps action string to a styled badge color. */
function actionBadgeClasses(action: string): string {
  if (action.startsWith('config_')) return 'bg-accent/10 text-accent border-accent/20'
  if (action.startsWith('device_')) return 'bg-info/10 text-info border-info/20'
  if (action.startsWith('alert_')) return 'bg-warning/10 text-warning border-warning/20'
  if (action === 'login' || action === 'logout') return 'bg-success/10 text-success border-success/20'
  if (action.startsWith('firmware')) return 'bg-warning/10 text-warning border-warning/20'
  if (action.startsWith('bulk_')) return 'bg-error/10 text-error border-error/20'
  return 'bg-elevated text-text-secondary border-border'
}

interface AuditLogTableProps {
  tenantId: string
}

export function AuditLogTable({ tenantId }: AuditLogTableProps) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<number>(50)
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const params: AuditLogParams = {
    page,
    per_page: perPage,
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(dateFrom ? { date_from: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { date_to: new Date(dateTo + 'T23:59:59').toISOString() } : {}),
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', tenantId, page, perPage, actionFilter, dateFrom, dateTo],
    queryFn: () => auditLogsApi.list(tenantId, params),
    enabled: !!tenantId,
  })

  const totalPages = data ? Math.ceil(data.total / perPage) : 0

  // Client-side user email filter (since user search is by text, not UUID)
  const filteredItems = data?.items.filter((item) => {
    if (!userSearch) return true
    return item.user_email?.toLowerCase().includes(userSearch.toLowerCase())
  }) ?? []

  const handleExport = async () => {
    setExporting(true)
    try {
      await auditLogsApi.exportCsv(tenantId, {
        ...(actionFilter ? { action: actionFilter } : {}),
        ...(dateFrom ? { date_from: new Date(dateFrom).toISOString() } : {}),
        ...(dateTo ? { date_to: new Date(dateTo + 'T23:59:59').toISOString() } : {}),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Action filter */}
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
          aria-label="Filter by action"
          className="h-8 rounded-md border border-border bg-panel px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {ACTION_TYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>

        {/* Date from */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            aria-label="Filter from date"
            className="h-8 rounded-md border border-border bg-panel px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Date to */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            aria-label="Filter to date"
            className="h-8 rounded-md border border-border bg-panel px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* User search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search user..."
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            aria-label="Filter by user"
            className="h-8 rounded-md border border-border bg-panel pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent w-40"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Export CSV */}
        <button
          onClick={handleExport}
          disabled={exporting || !data?.total}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="mt-2 text-sm text-text-muted">Loading audit logs...</p>
          </div>
        ) : isError ? (
          <div className="p-8 text-center">
            <p className="text-sm text-error">Failed to load audit logs.</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No activity recorded"
            description={
              actionFilter || dateFrom || dateTo || userSearch
                ? 'Try adjusting your filters.'
                : 'Audit logs will appear here as actions are performed.'
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-elevated/50">
                <th scope="col" className="w-8 px-3 py-2"><span className="sr-only">Expand</span></th>
                <th scope="col" className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  Timestamp
                </th>
                <th scope="col" className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  User
                </th>
                <th scope="col" className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  Action
                </th>
                <th scope="col" className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  Resource
                </th>
                <th scope="col" className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  Device
                </th>
                <th scope="col" className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.map((item) => (
                <AuditLogRow
                  key={item.id}
                  item={item}
                  tenantId={tenantId}
                  isExpanded={expandedId === item.id}
                  onToggle={() =>
                    setExpandedId(expandedId === item.id ? null : item.id)
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value))
                setPage(1)
              }}
              aria-label="Rows per page"
              className="h-7 rounded border border-border bg-panel px-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>
              {(page - 1) * perPage + 1}--
              {Math.min(page * perPage, data.total)} of {data.total}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1}
              aria-label="First page"
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="px-2">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              aria-label="Last page"
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronsRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

interface AuditLogRowProps {
  item: AuditLogEntry
  tenantId: string
  isExpanded: boolean
  onToggle: () => void
}

function AuditLogRow({ item, tenantId, isExpanded, onToggle }: AuditLogRowProps) {
  const hasDetails =
    item.details && Object.keys(item.details).length > 0

  return (
    <>
      <tr
        className={cn(
          'hover:bg-elevated/30 transition-colors cursor-pointer',
          isExpanded && 'bg-elevated/20',
        )}
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        aria-expanded={isExpanded}
      >
        <td className="px-3 py-2 text-center">
          {hasDetails ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
            )
          ) : (
            <span className="inline-block h-3.5 w-3.5" />
          )}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span
            className="text-text-primary"
            title={new Date(item.created_at).toLocaleString()}
          >
            {formatRelativeTime(item.created_at)}
          </span>
        </td>
        <td className="px-3 py-2 text-text-secondary truncate max-w-[160px]">
          {item.user_email ?? '--'}
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border',
              actionBadgeClasses(item.action),
            )}
          >
            {item.action.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="px-3 py-2 text-text-secondary text-xs truncate max-w-[180px]">
          {item.resource_type ? (
            <>
              <span className="text-text-muted">{item.resource_type}</span>
              {item.resource_id && (
                <span className="ml-1 font-mono text-[11px]">
                  {item.resource_id.length > 12
                    ? item.resource_id.substring(0, 12) + '...'
                    : item.resource_id}
                </span>
              )}
            </>
          ) : (
            '--'
          )}
        </td>
        <td className="px-3 py-2 text-text-secondary truncate max-w-[120px]">
          {item.device_name && item.device_id ? (
            <DeviceLink tenantId={tenantId} deviceId={item.device_id}>
              {item.device_name}
            </DeviceLink>
          ) : (item.device_name ?? '--')}
        </td>
        <td className="px-3 py-2 text-text-muted font-mono text-xs">
          {item.ip_address ?? '--'}
        </td>
      </tr>

      {/* Expanded details row */}
      {isExpanded && hasDetails && (
        <tr className="bg-elevated/10">
          <td colSpan={7} className="px-6 py-3">
            <div className="text-xs text-text-muted mb-1 font-medium">
              Details
            </div>
            <pre className="rounded-md bg-background p-3 text-xs text-text-secondary font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">
              {JSON.stringify(item.details, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
