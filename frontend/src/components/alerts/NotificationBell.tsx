import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { alertEventsApi } from '@/lib/api'

interface NotificationBellProps {
  tenantId: string
}

export function NotificationBell({ tenantId }: NotificationBellProps) {
  const { data: count } = useQuery({
    queryKey: ['alert-event-count', tenantId],
    queryFn: () => alertEventsApi.activeCount(tenantId),
    refetchInterval: 60_000,
    enabled: !!tenantId,
  })

  const activeCount = count ?? 0

  return (
    <button
      className="relative p-1 rounded text-text-muted hover:text-text-primary transition-colors"
      aria-label={`${activeCount} active alert${activeCount !== 1 ? 's' : ''}`}
      title={`${activeCount} active alert${activeCount !== 1 ? 's' : ''}`}
    >
      <Bell className="h-3.5 w-3.5" />
      {activeCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-error text-white text-[8px] font-bold px-0.5 leading-none">
          {activeCount > 99 ? '99+' : activeCount}
        </span>
      )}
    </button>
  )
}
