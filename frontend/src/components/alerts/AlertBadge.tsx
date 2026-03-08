/**
 * AlertBadge — renders a red badge with active alert count.
 * Polls every 30 seconds. Returns null if count is 0.
 */

import { useQuery } from '@tanstack/react-query'
import { alertsApi } from '@/lib/alertsApi'
import { useAuth } from '@/lib/auth'

export function AlertBadge() {
  const { user } = useAuth()
  const tenantId = user?.tenant_id

  const { data } = useQuery({
    queryKey: ['alert-active-count', tenantId],
    queryFn: () => alertsApi.getActiveAlertCount(tenantId!),
    enabled: !!tenantId,
    refetchInterval: 30_000,
  })

  if (!data?.count) return null

  return (
    <span
      className="bg-error text-text-primary text-xs font-medium rounded-full px-1.5 py-0.5 leading-none min-w-[1.25rem] text-center"
      title={`${data.count} active alert${data.count === 1 ? '' : 's'}`}
    >
      {data.count > 99 ? '99+' : data.count}
    </span>
  )
}
