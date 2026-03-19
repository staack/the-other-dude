import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { alertEventsApi, type SiteAlertEventResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type FilterState = 'all' | 'active' | 'resolved'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface AlertEventsTableProps {
  tenantId: string
  siteId: string
}

export function AlertEventsTable({ tenantId, siteId }: AlertEventsTableProps) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterState>('all')

  const stateParam = filter === 'all' ? undefined : filter

  const { data, isLoading } = useQuery({
    queryKey: ['alert-events', tenantId, siteId, stateParam],
    queryFn: () => alertEventsApi.list(tenantId, siteId, stateParam),
  })

  const resolveMutation = useMutation({
    mutationFn: (eventId: string) => alertEventsApi.resolve(tenantId, eventId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-events', tenantId, siteId] })
      void queryClient.invalidateQueries({ queryKey: ['alert-event-count'] })
    },
  })

  const events = data?.items ?? []

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-elevated/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Alert Events</h3>
        <div className="flex gap-1">
          {(['all', 'active', 'resolved'] as FilterState[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium rounded transition-colors capitalize',
                filter === f
                  ? 'bg-accent text-white'
                  : 'bg-elevated text-text-muted hover:text-text-secondary',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-text-muted">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-text-muted">
            {filter === 'all' ? 'No alert events' : `No ${filter} alert events`}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">Severity</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">Message</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">Triggered</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-center">State</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt: SiteAlertEventResponse) => (
                <tr key={evt.id} className="border-b border-border/50 hover:bg-elevated/50 transition-colors">
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        'text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border',
                        evt.severity === 'critical'
                          ? 'bg-error/20 text-error border-error/40'
                          : 'bg-warning/20 text-warning border-warning/40',
                      )}
                    >
                      {evt.severity}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-text-primary max-w-xs truncate">
                    {evt.message}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-muted text-xs">
                    {timeAgo(evt.triggered_at)}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full',
                          evt.state === 'active' ? 'bg-error' : 'bg-success',
                        )}
                      />
                      <span className="text-xs text-text-secondary capitalize">{evt.state}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {evt.state === 'active' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resolveMutation.mutate(evt.id)}
                        disabled={resolveMutation.isPending}
                        className="text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Resolve
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {evt.resolved_at ? timeAgo(evt.resolved_at) : ''}
                        {evt.resolved_by ? ` by ${evt.resolved_by}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
