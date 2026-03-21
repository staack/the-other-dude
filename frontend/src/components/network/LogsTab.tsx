import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, RefreshCw } from 'lucide-react'
import { networkApi, type LogEntry } from '@/lib/networkApi'
import { Skeleton } from '@/components/ui/skeleton'

interface LogsTabProps {
  tenantId: string
  deviceId: string
  active: boolean
}

/** Common RouterOS log topics and their severity colors. */
function getTopicColor(topics: string): { bg: string; text: string } {
  const t = topics.toLowerCase()
  if (t.includes('critical') || t.includes('error')) {
    return { bg: 'bg-error/10', text: 'text-error' }
  }
  if (t.includes('warning')) {
    return { bg: 'bg-warning/10', text: 'text-warning' }
  }
  if (t.includes('info')) {
    return { bg: 'bg-accent/10', text: 'text-accent' }
  }
  return { bg: 'bg-elevated', text: 'text-text-muted' }
}

/** Whether a log entry has error/critical severity. */
function isErrorEntry(topics: string): boolean {
  const t = topics.toLowerCase()
  return t.includes('error') || t.includes('critical')
}

const TOPIC_OPTIONS = [
  'system',
  'firewall',
  'dhcp',
  'wireless',
  'interface',
  'error',
  'warning',
  'info',
  'critical',
  'dns',
  'ppp',
  'ipsec',
  'wireguard',
  'ospf',
  'bgp',
]

const LIMIT_OPTIONS = [50, 100, 200, 500]

function TopicBadge({ topics }: { topics: string }) {
  const colors = getTopicColor(topics)
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}
    >
      {topics}
    </span>
  )
}

function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3 py-2 px-3">
          <Skeleton className="h-4 w-32 shrink-0" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

export function LogsTab({ tenantId, deviceId, active }: LogsTabProps) {
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTopic, setSelectedTopic] = useState('')
  const [limit, setLimit] = useState(100)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value)
    }, 300)
  }, [])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const { data, isLoading, error } = useQuery({
    queryKey: ['device-logs', tenantId, deviceId, limit, selectedTopic, searchQuery],
    queryFn: () =>
      networkApi.getDeviceLogs(tenantId, deviceId, {
        limit,
        topic: selectedTopic || undefined,
        search: searchQuery || undefined,
      }),
    refetchInterval: active && autoRefresh ? 10_000 : false,
    enabled: active,
  })

  // Extract unique topics from data for reference
  const uniqueTopics = useMemo(() => {
    if (!data?.logs) return TOPIC_OPTIONS
    const fromData = new Set<string>()
    for (const entry of data.logs) {
      if (entry.topics) {
        for (const t of entry.topics.split(',')) {
          fromData.add(t.trim())
        }
      }
    }
    // Merge with common topics, deduplicate
    const all = new Set([...TOPIC_OPTIONS, ...fromData])
    return [...all].sort()
  }, [data])

  return (
    <div className="mt-4 space-y-3">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border bg-elevated/50 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent [color-scheme:dark]"
          />
        </div>

        {/* Topic filter */}
        <select
          value={selectedTopic}
          onChange={(e) => setSelectedTopic(e.target.value)}
          className="text-xs rounded border border-border bg-elevated/50 text-text-primary px-2 py-1.5 [color-scheme:dark]"
        >
          <option value="">All Topics</option>
          {uniqueTopics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>

        {/* Limit selector */}
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="text-xs rounded border border-border bg-elevated/50 text-text-primary px-2 py-1.5 [color-scheme:dark]"
        >
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} entries
            </option>
          ))}
        </select>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors ${
            autoRefresh
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border bg-elevated/50 text-text-muted hover:text-text-primary'
          }`}
          title={autoRefresh ? 'Auto-refresh on (10s)' : 'Auto-refresh off'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
          Auto
        </button>
      </div>

      {/* Log table */}
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <div className="p-6 text-center text-sm text-error">
            Failed to fetch device logs. The device may be offline or unreachable.
          </div>
        ) : !data || data.logs.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-text-primary mb-1">No log entries found</p>
            <p className="text-xs text-text-muted">
              {searchQuery || selectedTopic
                ? 'Try adjusting your search or topic filter.'
                : 'Device returned no logs.'}
            </p>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="sticky top-0 z-10 bg-elevated/95 backdrop-blur-sm">
                <tr className="border-b border-border">
                  <th className="py-2 px-3 text-[10px] font-medium text-text-muted uppercase tracking-wider w-[160px]">
                    Time
                  </th>
                  <th className="py-2 px-3 text-[10px] font-medium text-text-muted uppercase tracking-wider w-[140px]">
                    Topics
                  </th>
                  <th className="py-2 px-3 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((entry: LogEntry, i: number) => {
                  const errorRow = isErrorEntry(entry.topics)
                  return (
                    <tr
                      key={`${entry.time}-${i}`}
                      className={`border-b border-border/50 last:border-b-0 ${
                        errorRow
                          ? 'bg-error/5'
                          : i % 2 === 0
                            ? ''
                            : 'bg-elevated/30'
                      }`}
                    >
                      <td className="py-1.5 px-3 text-text-muted whitespace-nowrap align-top">
                        {entry.time}
                      </td>
                      <td className="py-1.5 px-3 align-top">
                        <TopicBadge topics={entry.topics} />
                      </td>
                      <td
                        className={`py-1.5 px-3 break-all ${
                          errorRow ? 'text-error' : 'text-text-primary'
                        }`}
                      >
                        {entry.message}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Entry count */}
      {data && data.count > 0 && (
        <div className="text-[10px] text-text-muted text-right">
          Showing {data.count} entr{data.count === 1 ? 'y' : 'ies'}
          {autoRefresh && ' (auto-refreshing every 10s)'}
        </div>
      )}
    </div>
  )
}
