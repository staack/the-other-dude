/**
 * Filterable, paginated transparency log table with stats cards, expandable
 * row details, and CSV export.
 *
 * Shows every KMS credential access event for the tenant -- timestamp,
 * device name, action, justification, operator, and correlation ID.
 *
 * Phase 31 -- Data Access Transparency Dashboard (TRUST-01, TRUST-02)
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
  Eye,
  Activity,
  Clock,
  HardDrive,
} from 'lucide-react'
import {
  transparencyApi,
  type TransparencyLogEntry,
  type TransparencyLogParams,
} from '@/lib/transparencyApi'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUSTIFICATION_TYPES = [
  { value: '', label: 'All Justifications' },
  { value: 'poller', label: 'Scheduled Poll' },
  { value: 'config_push', label: 'Config Push' },
  { value: 'backup', label: 'Config Backup' },
  { value: 'command', label: 'Remote Command' },
  { value: 'api_backup', label: 'API Backup' },
] as const

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'decrypt_credential', label: 'Decrypt Credential' },
  { value: 'encrypt_credential', label: 'Encrypt Credential' },
  { value: 'rotate_key', label: 'Rotate Key' },
  { value: 'provision_key', label: 'Provision Key' },
] as const

const PER_PAGE_OPTIONS = [25, 50, 100] as const

/** Human-readable justification labels. */
function justificationLabel(justification: string | null): string {
  if (!justification) return 'System'
  const map: Record<string, string> = {
    poller: 'Scheduled Poll',
    config_push: 'Config Push',
    backup: 'Config Backup',
    command: 'Remote Command',
    api_backup: 'API Backup',
  }
  return map[justification] ?? 'System'
}

/** Justification badge color classes. */
function justificationBadgeClasses(justification: string | null): string {
  switch (justification) {
    case 'poller':
      return 'bg-info/10 text-info border-info/20'
    case 'config_push':
      return 'bg-warning/10 text-warning border-warning/20'
    case 'backup':
    case 'api_backup':
      return 'bg-success/10 text-success border-success/20'
    case 'command':
      return 'bg-error/10 text-error border-error/20'
    default:
      return 'bg-elevated text-text-secondary border-border'
  }
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TransparencyLogTableProps {
  tenantId: string
}

export function TransparencyLogTable({ tenantId }: TransparencyLogTableProps) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<number>(50)
  const [justificationFilter, setJustificationFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const params: TransparencyLogParams = {
    page,
    per_page: perPage,
    ...(justificationFilter ? { justification: justificationFilter } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(dateFrom ? { date_from: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { date_to: new Date(dateTo + 'T23:59:59').toISOString() } : {}),
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'transparency-logs',
      tenantId,
      page,
      perPage,
      justificationFilter,
      actionFilter,
      dateFrom,
      dateTo,
    ],
    queryFn: () => transparencyApi.list(tenantId, params),
    enabled: !!tenantId,
  })

  const { data: stats } = useQuery({
    queryKey: ['transparency-stats', tenantId],
    queryFn: () => transparencyApi.stats(tenantId),
    enabled: !!tenantId,
  })

  const totalPages = data ? Math.ceil(data.total / perPage) : 0

  const handleExport = async () => {
    setExporting(true)
    try {
      await transparencyApi.exportCsv(tenantId, {
        ...(justificationFilter ? { justification: justificationFilter } : {}),
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
      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsCard
            icon={Activity}
            label="Total Events"
            value={stats.total_events.toLocaleString()}
          />
          <StatsCard
            icon={Clock}
            label="Last 24 Hours"
            value={stats.events_last_24h.toLocaleString()}
          />
          <StatsCard
            icon={HardDrive}
            label="Unique Devices"
            value={stats.unique_devices.toLocaleString()}
          />
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-2">
              By Justification
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.justification_breakdown).map(([key, count]) => (
                <span
                  key={key}
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border',
                    justificationBadgeClasses(key === 'system' ? null : key),
                  )}
                >
                  {justificationLabel(key === 'system' ? null : key)}: {count}
                </span>
              ))}
              {Object.keys(stats.justification_breakdown).length === 0 && (
                <span className="text-xs text-text-muted">No events</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Justification filter */}
        <select
          value={justificationFilter}
          onChange={(e) => {
            setJustificationFilter(e.target.value)
            setPage(1)
          }}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {JUSTIFICATION_TYPES.map((j) => (
            <option key={j.value} value={j.value}>
              {j.label}
            </option>
          ))}
        </select>

        {/* Action filter */}
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value)
            setPage(1)
          }}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
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
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(1)
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Date to */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(1)
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Export CSV */}
        <button
          onClick={handleExport}
          disabled={exporting || !data?.total}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="mt-2 text-sm text-text-muted">
              Loading transparency logs...
            </p>
          </div>
        ) : isError ? (
          <div className="p-8 text-center">
            <p className="text-sm text-error">
              Failed to load transparency logs.
            </p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Eye}
            title="No credential access events"
            description={
              justificationFilter || actionFilter || dateFrom || dateTo
                ? 'Try adjusting your filters.'
                : 'Credential access events will appear here as the system accesses device credentials.'
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-elevated/50">
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                  Time
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                  Device
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                  Action
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                  Justification
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                  Operator
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                  Correlation ID
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((item) => (
                <TransparencyLogRow
                  key={item.id}
                  item={item}
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
              className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
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
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="rounded p-1 hover:bg-elevated disabled:opacity-30"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stats card sub-component
// ---------------------------------------------------------------------------

interface StatsCardProps {
  icon: React.FC<{ className?: string }>
  label: string
  value: string
}

function StatsCard({ icon: Icon, label, value }: StatsCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
          {label}
        </span>
      </div>
      <div className="text-xl font-semibold text-text-primary">{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

interface TransparencyLogRowProps {
  item: TransparencyLogEntry
  isExpanded: boolean
  onToggle: () => void
}

function TransparencyLogRow({
  item,
  isExpanded,
  onToggle,
}: TransparencyLogRowProps) {
  const hasDetails = !!(item.resource_type || item.resource_id || item.ip_address)

  return (
    <>
      <tr
        className={cn(
          'hover:bg-elevated/30 transition-colors cursor-pointer',
          isExpanded && 'bg-elevated/20',
        )}
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-center">
          {hasDetails ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
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
        <td className="px-3 py-2 text-text-secondary truncate max-w-[140px]">
          {item.device_name ?? '--'}
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border bg-accent/10 text-accent border-accent/20">
            {item.action.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border',
              justificationBadgeClasses(item.justification),
            )}
          >
            {justificationLabel(item.justification)}
          </span>
        </td>
        <td className="px-3 py-2 text-text-secondary truncate max-w-[160px]">
          {item.operator_email ?? '--'}
        </td>
        <td className="px-3 py-2 text-text-muted font-mono text-[11px] truncate max-w-[120px]">
          {item.correlation_id
            ? item.correlation_id.length > 12
              ? item.correlation_id.substring(0, 12) + '...'
              : item.correlation_id
            : '--'}
        </td>
      </tr>

      {/* Expanded details row */}
      {isExpanded && hasDetails && (
        <tr className="bg-elevated/10">
          <td colSpan={7} className="px-6 py-3">
            <div className="grid grid-cols-3 gap-4 text-xs">
              {item.resource_type && (
                <div>
                  <span className="text-text-muted">Resource Type:</span>{' '}
                  <span className="text-text-secondary">{item.resource_type}</span>
                </div>
              )}
              {item.resource_id && (
                <div>
                  <span className="text-text-muted">Resource ID:</span>{' '}
                  <span className="text-text-secondary font-mono">
                    {item.resource_id}
                  </span>
                </div>
              )}
              {item.ip_address && (
                <div>
                  <span className="text-text-muted">IP Address:</span>{' '}
                  <span className="text-text-secondary font-mono">
                    {item.ip_address}
                  </span>
                </div>
              )}
              {item.correlation_id && (
                <div>
                  <span className="text-text-muted">Full Correlation ID:</span>{' '}
                  <span className="text-text-secondary font-mono">
                    {item.correlation_id}
                  </span>
                </div>
              )}
              {item.device_id && (
                <div>
                  <span className="text-text-muted">Device ID:</span>{' '}
                  <span className="text-text-secondary font-mono">
                    {item.device_id}
                  </span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
