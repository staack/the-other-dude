import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { devicesApi, metricsApi, type DeviceResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatUptime } from '@/lib/utils'

interface SiteHealthGridProps {
  tenantId: string
  siteId: string
}

function cpuColor(pct: number | null): string {
  if (pct == null) return 'bg-elevated'
  if (pct >= 90) return 'bg-error'
  if (pct >= 70) return 'bg-warning'
  return 'bg-success'
}

function memColor(pct: number | null): string {
  if (pct == null) return 'bg-elevated'
  if (pct >= 90) return 'bg-error'
  if (pct >= 70) return 'bg-warning'
  return 'bg-success'
}

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    online: 'bg-online shadow-[0_0_6px_hsl(var(--online)/0.3)]',
    offline: 'bg-offline shadow-[0_0_6px_hsl(var(--offline)/0.3)]',
    unknown: 'bg-unknown',
  }
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', styles[status] ?? styles.unknown)}
      title={status}
    />
  )
}

function borderColor(status: string): string {
  if (status === 'online') return 'border-success/50'
  if (status === 'offline') return 'border-error/50'
  return 'border-warning/50'
}

export function SiteHealthGrid({ tenantId, siteId }: SiteHealthGridProps) {
  const { data: deviceData, isLoading: devicesLoading } = useQuery({
    queryKey: ['site-devices', tenantId, siteId],
    queryFn: () => devicesApi.list(tenantId, { site_id: siteId, page_size: 100 }),
  })

  // Fleet summary has CPU/memory data
  const { data: fleetData } = useQuery({
    queryKey: ['fleet-summary', tenantId],
    queryFn: () => metricsApi.fleetSummary(tenantId),
  })

  if (devicesLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-panel p-4 space-y-3 animate-pulse">
            <div className="h-4 w-24 bg-elevated rounded" />
            <div className="h-1.5 w-full bg-elevated rounded-full" />
            <div className="h-1.5 w-full bg-elevated rounded-full" />
            <div className="h-3 w-16 bg-elevated rounded" />
          </div>
        ))}
      </div>
    )
  }

  const devices = deviceData?.items ?? []

  if (devices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-8 text-center">
        <p className="text-sm text-text-muted">
          No devices assigned to this site. Assign devices from the fleet page.
        </p>
      </div>
    )
  }

  // Build a map of device metrics from fleet summary
  const metricsMap = new Map<string, { cpu: number | null; mem: number | null }>()
  if (fleetData) {
    for (const fd of fleetData) {
      metricsMap.set(fd.id, { cpu: fd.last_cpu_load, mem: fd.last_memory_used_pct })
    }
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {devices.map((device: DeviceResponse) => {
        const metrics = metricsMap.get(device.id)
        const cpu = metrics?.cpu ?? null
        const mem = metrics?.mem ?? null

        return (
          <Link
            key={device.id}
            to="/tenants/$tenantId/devices/$deviceId"
            params={{ tenantId, deviceId: device.id }}
            className={cn(
              'rounded-lg border bg-panel p-4 space-y-2 hover:bg-elevated/50 transition-colors block',
              borderColor(device.status),
            )}
          >
            <div className="flex items-center gap-2">
              <StatusDot status={device.status} />
              <span className="font-semibold text-sm text-text-primary truncate">
                {device.hostname}
              </span>
            </div>

            {/* CPU bar */}
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px] text-text-muted">
                <span>CPU</span>
                <span>{cpu != null ? `${Math.round(cpu)}%` : '--'}</span>
              </div>
              <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                {cpu != null && (
                  <div
                    className={cn('h-full rounded-full transition-all', cpuColor(cpu))}
                    style={{ width: `${Math.min(cpu, 100)}%` }}
                  />
                )}
              </div>
            </div>

            {/* Memory bar */}
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px] text-text-muted">
                <span>Memory</span>
                <span>{mem != null ? `${Math.round(mem)}%` : '--'}</span>
              </div>
              <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                {mem != null && (
                  <div
                    className={cn('h-full rounded-full transition-all', memColor(mem))}
                    style={{ width: `${Math.min(mem, 100)}%` }}
                  />
                )}
              </div>
            </div>

            {/* Uptime */}
            <div className="text-[10px] text-text-muted">
              Uptime: {formatUptime(device.uptime_seconds)}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
