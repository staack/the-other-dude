import { useQuery } from '@tanstack/react-query'
import { Wifi, CheckCircle2 } from 'lucide-react'
import { metricsApi } from '@/lib/api'

interface WirelessIssuesProps {
  tenantId: string | null  // null = all orgs (super admin)
}

function signalColor(signal: number | null): string {
  if (signal === null) return 'text-text-muted'
  if (signal > -60) return 'text-success'
  if (signal > -70) return 'text-warning'
  return 'text-error'
}

export function WirelessIssues({ tenantId }: WirelessIssuesProps) {
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['wireless-issues', tenantId],
    queryFn: () =>
      tenantId
        ? metricsApi.wirelessIssues(tenantId)
        : metricsApi.fleetWirelessIssues(),
    refetchInterval: 60_000,
  })

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
        <Wifi className="h-4 w-4 text-text-muted" />
        APs Needing Attention
      </h3>

      {isLoading ? (
        <div className="text-sm text-text-muted">Loading...</div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-success" />
          <span className="text-sm font-medium text-success">All APs Healthy</span>
          <span className="text-xs text-text-muted">No wireless issues detected</span>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((ap, i) => (
            <div
              key={`${ap.device_id}-${ap.interface}-${i}`}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-elevated/30 hover:bg-elevated/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  ap.signal !== null && ap.signal < -75 ? 'bg-error' :
                  ap.ccq !== null && ap.ccq < 50 ? 'bg-error' :
                  'bg-warning'
                }`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {ap.hostname}
                    <span className="text-xs text-text-muted ml-1">({ap.interface})</span>
                  </div>
                  {ap.tenant_name && (
                    <div className="text-xs text-text-muted">{ap.tenant_name}</div>
                  )}
                </div>
              </div>
              <div className={`text-sm font-mono whitespace-nowrap ${signalColor(ap.signal)}`}>
                {ap.issue}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
