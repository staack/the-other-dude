import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, Server, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { eventsApi, type DashboardEvent, type EventsParams } from '@/lib/eventsApi'
import { DeviceLink } from '@/components/ui/device-link'

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
    <div className="bg-panel border border-border rounded-sm">
      <div className="px-3 py-2 border-b border-border-subtle bg-elevated flex items-center justify-between">
        <span className="text-[7px] font-medium text-text-muted uppercase tracking-[1.5px]">
          Recent Events
        </span>
        <div className="flex gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setFilterType(f.value)}
              className={cn(
                'px-1.5 py-0.5 rounded-sm text-[10px] font-medium transition-[background-color,color] duration-[50ms]',
                filterType === f.value
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        {isSuperAdmin && !tenantId ? (
          <div className="py-5 text-center text-[9px] text-text-muted">
            Select a tenant to view events
          </div>
        ) : isLoading ? (
          <div className="py-5 text-center text-[9px] text-text-muted">
            Loading…
          </div>
        ) : !events || events.length === 0 ? (
          <div className="py-5 text-center text-[9px] text-text-muted">
            No recent events
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border-subtle">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-2.5 px-3 py-1.5"
              >
                <div className="shrink-0">
                  <EventIcon event={event} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-text-primary truncate block">
                    {event.title}
                  </span>
                  <span className="text-[10px] text-text-muted truncate block">
                    {event.description}
                    {event.device_hostname && (
                      <span className="ml-1 text-text-secondary">
                        &mdash;{' '}
                        {event.device_id ? (
                          <DeviceLink tenantId={tenantId} deviceId={event.device_id}>
                            {event.device_hostname}
                          </DeviceLink>
                        ) : (
                          event.device_hostname
                        )}
                      </span>
                    )}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-text-muted whitespace-nowrap shrink-0">
                  {formatRelativeTime(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
