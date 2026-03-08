/**
 * CertificatesPage -- Main certificate management page.
 *
 * Two sections:
 * 1. CA Status Card -- shows CA state or initialization prompt
 * 2. Device Certificates Table -- per-device cert status with actions
 */

import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '@/lib/store'
import { Shield, Building2 } from 'lucide-react'
import {
  certificatesApi,
  type CAResponse,
  type DeviceCertResponse,
} from '@/lib/certificatesApi'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { canWrite } from '@/lib/auth'
import { CAStatusCard } from './CAStatusCard'
import { DeviceCertTable } from './DeviceCertTable'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/page-skeleton'

export function CertificatesPage() {
  const { user } = useAuth()
  const writable = canWrite(user)

  const { selectedTenantId } = useUIStore()
  const tenantId = isSuperAdmin(user)
    ? (selectedTenantId ?? '')
    : (user?.tenant_id ?? '')

  // ── Queries ──

  const {
    data: ca,
    isLoading: caLoading,
  } = useQuery({
    queryKey: ['ca', tenantId],
    queryFn: () => certificatesApi.getCA(tenantId),
    enabled: !!tenantId,
  })

  const {
    data: deviceCerts = [],
    isLoading: certsLoading,
  } = useQuery({
    queryKey: ['deviceCerts', tenantId],
    queryFn: () => certificatesApi.getDeviceCerts(undefined, tenantId),
    enabled: !!tenantId && ca !== undefined,
  })

  // Super admin needs to select a tenant from the header
  if (isSuperAdmin(user) && !tenantId) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-text-muted" />
          <h1 className="text-2xl font-bold text-text-primary">
            Certificate Authority
          </h1>
        </div>
        <EmptyState
          icon={Building2}
          title="No Organization Selected"
          description="Select an organization from the header to manage certificates."
        />
      </div>
    )
  }

  if (caLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-text-muted" />
          <h1 className="text-2xl font-bold text-text-primary">
            Certificate Authority
          </h1>
        </div>
        <TableSkeleton rows={3} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-text-muted" />
        <h1 className="text-2xl font-bold text-text-primary">
          Certificate Authority
        </h1>
      </div>

      {/* CA Status */}
      <section>
        <CAStatusCard ca={ca ?? null} canWrite={writable} tenantId={tenantId} />
      </section>

      {/* Device Certificates (only when CA exists) */}
      {ca && (
        <section>
          <DeviceCertTable
            certs={deviceCerts}
            loading={certsLoading}
            caExists={!!ca}
            canWrite={writable}
            tenantId={tenantId}
          />
        </section>
      )}
    </div>
  )
}
