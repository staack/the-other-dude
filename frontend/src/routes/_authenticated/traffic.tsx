import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Inbox } from 'lucide-react'
import { metricsApi } from '@/lib/api'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DeviceLink } from '@/components/ui/device-link'

export const Route = createFileRoute('/_authenticated/traffic')({
  component: TrafficPage,
})

function cpuColor(cpu: number | null): string {
  if (cpu === null) return 'text-text-muted'
  if (cpu < 50) return 'text-success'
  if (cpu < 80) return 'text-warning'
  return 'text-error'
}

function memColor(mem: number | null): string {
  if (mem === null) return 'text-text-muted'
  if (mem < 60) return 'text-success'
  if (mem < 85) return 'text-warning'
  return 'text-error'
}

function statusDot(status: string) {
  const color =
    status === 'online'
      ? 'bg-success'
      : status === 'degraded'
        ? 'bg-warning'
        : 'bg-error'
  return <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
}

function TrafficPage() {
  const { user } = useAuth()
  const selectedTenantId = useUIStore((s) => s.selectedTenantId)
  const superAdmin = isSuperAdmin(user)

  const tenantId = superAdmin ? selectedTenantId : user?.tenant_id

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['fleet-summary', tenantId, superAdmin],
    queryFn: () =>
      superAdmin && !tenantId
        ? metricsApi.fleetSummaryAll()
        : metricsApi.fleetSummary(tenantId!),
    enabled: !!tenantId || superAdmin,
    refetchInterval: 30_000,
  })

  // Sort by CPU load descending, nulls last
  const sorted = [...devices].sort((a, b) => {
    const aCpu = a.last_cpu_load ?? -1
    const bCpu = b.last_cpu_load ?? -1
    return bCpu - aCpu
  })

  const top10 = sorted.slice(0, 10)

  const avgCpu =
    devices.length > 0
      ? devices.reduce((sum, d) => sum + (d.last_cpu_load ?? 0), 0) / devices.length
      : null

  const avgMem =
    devices.length > 0
      ? devices.reduce((sum, d) => sum + (d.last_memory_used_pct ?? 0), 0) / devices.length
      : null

  const onlineCount = devices.filter((d) => d.status === 'online').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Traffic</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border bg-surface">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Fleet Avg CPU
            </p>
            <p
              className={cn(
                'mt-1 text-2xl font-mono',
                isLoading ? 'text-text-muted' : cpuColor(avgCpu),
              )}
            >
              {isLoading ? '--' : avgCpu !== null ? `${avgCpu.toFixed(1)}%` : 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-surface">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Fleet Avg Memory
            </p>
            <p
              className={cn(
                'mt-1 text-2xl font-mono',
                isLoading ? 'text-text-muted' : memColor(avgMem),
              )}
            >
              {isLoading ? '--' : avgMem !== null ? `${avgMem.toFixed(1)}%` : 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-surface">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Devices Online
            </p>
            <p className="mt-1 text-2xl font-mono text-text-secondary">
              {isLoading ? '--' : `${onlineCount} / ${devices.length}`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Resource Consumers */}
      {isLoading ? (
        <Card className="border-border bg-surface">
          <CardContent className="p-6">
            <p className="text-sm text-text-muted">Loading fleet data...</p>
          </CardContent>
        </Card>
      ) : devices.length === 0 ? (
        <Card className="border-border bg-surface">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12">
            <Inbox className="h-10 w-10 text-text-muted" />
            <p className="text-sm font-medium text-text-secondary">
              No device data available
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Top Resource Consumers
          </h2>
          <Card className="border-border bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                      Hostname
                    </th>
                    {superAdmin && !tenantId && (
                      <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                        Tenant
                      </th>
                    )}
                    <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                      IP Address
                    </th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                      CPU Load
                    </th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                      Memory %
                    </th>
                    <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-center">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((device) => (
                    <tr
                      key={device.id}
                      className="border-b border-border/50 hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {tenantId ? (
                          <DeviceLink tenantId={tenantId} deviceId={device.id}>
                            {device.hostname}
                          </DeviceLink>
                        ) : device.hostname}
                      </td>
                      {superAdmin && !tenantId && (
                        <td className="px-4 py-3 text-sm font-mono text-text-muted">
                          {device.tenant_name}
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                        {device.ip_address}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-sm font-mono text-right',
                          cpuColor(device.last_cpu_load),
                        )}
                      >
                        {device.last_cpu_load !== null
                          ? `${device.last_cpu_load}%`
                          : '--'}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-sm font-mono text-right',
                          memColor(device.last_memory_used_pct),
                        )}
                      >
                        {device.last_memory_used_pct !== null
                          ? `${device.last_memory_used_pct.toFixed(1)}%`
                          : '--'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {statusDot(device.status)}
                          <span className="text-sm text-text-secondary capitalize">
                            {device.status}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
