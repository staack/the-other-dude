import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { tenantsApi, type SubnetScanResponse } from '@/lib/api'
import { SubnetScanForm } from '@/components/fleet/SubnetScanForm'
import { ScanResultsList } from '@/components/fleet/ScanResultsList'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/devices/scan')({
  component: ScanPage,
})

function ScanPage() {
  const { tenantId } = Route.useParams()
  const navigate = useNavigate()
  const [results, setResults] = useState<SubnetScanResponse | null>(null)

  const { data: tenant } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => tenantsApi.get(tenantId),
  })

  const handleDone = () => {
    void navigate({ to: '/tenants/$tenantId/devices', params: { tenantId } })
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <Link to="/tenants" className="hover:text-text-secondary transition-colors">
          Tenants
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link
          to="/tenants/$tenantId"
          params={{ tenantId }}
          className="hover:text-text-secondary transition-colors"
        >
          {tenant?.name ?? tenantId}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link
          to="/tenants/$tenantId/devices"
          params={{ tenantId }}
          className="hover:text-text-secondary transition-colors"
        >
          Devices
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">Scan Subnet</span>
      </div>

      <SubnetScanForm tenantId={tenantId} onResults={setResults} />

      {results && (
        <ScanResultsList tenantId={tenantId} results={results} onDone={handleDone} />
      )}
    </div>
  )
}
