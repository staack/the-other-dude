import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { snmpProfilesApi } from '@/lib/api'

interface SNMPMetricsSectionProps {
  tenantId: string
  deviceId: string
  snmpProfileId: string | null
}

/**
 * Displays the assigned SNMP profile info for an SNMP device.
 *
 * Standard metrics (interfaces, health) flow through existing hypertables
 * and are shown by InterfaceGauges. Custom OID charting is Phase 20 (PROF-03).
 */
export function SNMPMetricsSection({ tenantId, snmpProfileId }: SNMPMetricsSectionProps) {
  const { data: profile } = useQuery({
    queryKey: ['snmp-profile', tenantId, snmpProfileId],
    queryFn: () => snmpProfilesApi.get(tenantId, snmpProfileId!),
    enabled: !!snmpProfileId && !!tenantId,
  })

  if (!snmpProfileId) return null

  return (
    <div className="rounded-sm border border-border-default bg-panel px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-4 w-4 text-text-muted" />
        <h3 className="text-sm font-medium text-text-secondary">SNMP Profile</h3>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-3 py-1 border-b border-border-subtle">
          <span className="text-[10px] text-text-muted w-24 flex-shrink-0">Profile</span>
          <span className="text-xs text-text-primary">
            {profile?.name ?? 'Loading...'}
            {profile?.is_system && (
              <span className="ml-1.5 text-[10px] text-text-muted">(system)</span>
            )}
          </span>
        </div>
        {profile?.description && (
          <div className="flex items-center gap-3 py-1">
            <span className="text-[10px] text-text-muted w-24 flex-shrink-0">Description</span>
            <span className="text-xs text-text-secondary">{profile.description}</span>
          </div>
        )}
      </div>
    </div>
  )
}
