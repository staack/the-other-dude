import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, Server, HardDrive } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { eventsApi, type DashboardEvent, type EventsParams } from '@/lib/eventsApi'

export interface EventsTimelineProps {
  tenantId: string
  isSuperAdmin: boolean
}

type EventFilter = EventsParams['event_type'] | undefined

const FILTERS: { label: string; value: EventFilter }[] = [
  { label: 'All', value: undefined },
  { label: 'Alerts', value: 'alert' },
  { label: 'Status', value: 'status_change' },
  { label: 'Backups', value: 'config_backup' },
]

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

/** Maps event severity to a text color class. */
function severityColor(severity: DashboardEvent['severity']): string {
  switch (severity) {
    case 'critical':
      return 'text-error'
    case 'warning':
      return 'text-warning'
    case 'info':
      return 'text-accent'
    default:
      return 'text-text-muted'
  }
}

/** Returns the appropriate icon for an event type. */
function EventIcon({ event }: { event: DashboardEvent }) {
  switch (event.event_type) {
    case 'alert':
      return <Bell className={cn('h-4 w-4', severityColor(event.severity))} />
    case 'status_change':
      return (
        <Server
          className={cn(
            'h-4 w-4',
            event.severity === 'critical' ? 'text-error' : 'text-success',
          )}
        />
      )
    case 'config_backup':
      return <HardDrive className="h-4 w-4 text-accent" />
    default:
      return <Bell className="h-4 w-4 text-text-muted" />
  }
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 pl-3">
          <Skeleton className="h-4 w-4 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function EventsTimeline({ tenantId, isSuperAdmin }: EventsTimelineProps) {
  const [filterType, setFilterType] = useState<EventFilter>(undefined)

  const { data: events, isLoading } = useQuery({
    queryKey: ['dashboard-events', tenantId, filterType],
    queryFn: () =>
      eventsApi.getEvents(tenantId, {
        limit: 50,
        event_type: filterType || undefined,
      }),
    staleTime: 30_000,
    enabled: !!tenantId,
  })

  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-text-secondary">
            Recent Events
          </CardTitle>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => setFilterType(f.value)}
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                  filterType === f.value
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-secondary hover:bg-elevated/50',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isSuperAdmin && !tenantId ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            Select a tenant to view events
          </div>
        ) : isLoading ? (
          <TimelineSkeleton />
        ) : !events || events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            No recent events
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto pr-1">
            <div className="relative border-l-2 border-border ml-2">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="relative flex items-start gap-3 pb-3 pl-4 last:pb-0"
                >
                  {/* Icon positioned over the timeline line */}
                  <div className="absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface">
                    <EventIcon event={event} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 ml-1">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {event.title}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {event.description}
                      {event.device_hostname && (
                        <span className="ml-1 text-text-secondary">
                          &mdash; {event.device_hostname}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-text-muted whitespace-nowrap shrink-0 mt-0.5">
                    {formatRelativeTime(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
