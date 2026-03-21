import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Wifi, CheckCircle2 } from 'lucide-react'
import { metricsApi } from '@/lib/api'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DeviceLink } from '@/components/ui/device-link'

export const Route = createFileRoute('/_authenticated/wireless')({
  component: WirelessPage,
})

function signalColor(signal: number | null): string {
  if (signal === null) return 'text-text-muted'
  if (signal > -60) return 'text-success'
  if (signal > -70) return 'text-warning'
  return 'text-error'
}

function WirelessPage() {
  const { user } = useAuth()
  const selectedTenantId = useUIStore((s) => s.selectedTenantId)
  const superAdmin = isSuperAdmin(user)

  const tenantId = superAdmin ? selectedTenantId : user?.tenant_id

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['wireless-issues', tenantId, superAdmin],
    queryFn: () =>
      superAdmin && !tenantId
        ? metricsApi.fleetWirelessIssues()
        : metricsApi.wirelessIssues(tenantId!),
    enabled: !!tenantId || superAdmin,
    refetchInterval: 30_000,
  })

  const worstSignal =
    issues.length > 0
      ? issues.reduce<number | null>((worst, i) => {
          if (i.signal === null) return worst
          if (worst === null) return i.signal
          return i.signal < worst ? i.signal : worst
        }, null)
      : null

  const totalClients = issues.reduce((sum, i) => sum + i.client_count, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wifi className="h-5 w-5 text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Wireless</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border bg-panel">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              APs with Issues
            </p>
            <p className="mt-1 text-2xl font-mono text-text-secondary">
              {isLoading ? '--' : issues.length}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-panel">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Worst Signal
            </p>
            <p
              className={cn(
                'mt-1 text-2xl font-mono',
                isLoading ? 'text-text-muted' : signalColor(worstSignal),
              )}
            >
              {isLoading ? '--' : worstSignal !== null ? `${worstSignal} dBm` : 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-panel">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Total Clients
            </p>
            <p className="mt-1 text-2xl font-mono text-text-secondary">
              {isLoading ? '--' : totalClients}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Issues Table or All Clear */}
      {isLoading ? (
        <Card className="border-border bg-panel">
          <CardContent className="p-6">
            <p className="text-sm text-text-muted">Loading wireless data...</p>
          </CardContent>
        </Card>
      ) : issues.length === 0 ? (
        <Card className="border-border bg-panel">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="text-sm font-medium text-text-secondary">
              All Clear — no wireless issues detected
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-panel overflow-hidden">
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
                    Interface
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                    Issue
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                    Signal
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                    CCQ
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                    Clients
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">
                    Frequency
                  </th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, idx) => (
                  <tr
                    key={`${issue.device_id}-${issue.interface}-${idx}`}
                    className="border-b border-border/50 hover:bg-panel-hover transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-error" />
                        {tenantId && issue.device_id ? (
                          <DeviceLink tenantId={tenantId} deviceId={issue.device_id}>
                            {issue.hostname}
                          </DeviceLink>
                        ) : issue.hostname}
                      </div>
                    </td>
                    {superAdmin && !tenantId && (
                      <td className="px-4 py-3 text-sm font-mono text-text-muted">
                        {issue.tenant_name ?? '--'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {issue.interface}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {issue.issue}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-sm font-mono text-right',
                        signalColor(issue.signal),
                      )}
                    >
                      {issue.signal !== null ? `${issue.signal} dBm` : '--'}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary text-right">
                      {issue.ccq !== null ? `${issue.ccq}%` : '--'}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary text-right">
                      {issue.client_count}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary text-right">
                      {issue.frequency ? `${issue.frequency} MHz` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
