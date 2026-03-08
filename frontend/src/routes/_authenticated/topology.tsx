/**
 * Topology page route -- /_authenticated/topology
 *
 * Renders a full-height reactflow network topology map for the user's tenant.
 * Uses the global org selector in the header for tenant context.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Building2, Network, ChevronRight } from 'lucide-react'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { TopologyMap } from '@/components/network/TopologyMap'

export const Route = createFileRoute('/_authenticated/topology')({
  component: TopologyPage,
})

function TopologyPage() {
  const { user } = useAuth()
  const isSuper = isSuperAdmin(user)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-3">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <span>Home</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-text-secondary">Topology</span>
        </div>

        {/* Title */}
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Network className="h-5 w-5 text-text-muted" />
          Network Topology
        </h1>
      </div>

      {/* Topology map (full remaining height) */}
      <div className="flex-1 min-h-0 mx-4 mb-4 rounded-lg border border-border bg-surface overflow-hidden">
        {tenantId ? (
          <TopologyMap tenantId={tenantId} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <Building2 className="h-8 w-8 text-text-muted mb-3" />
            <p className="text-sm text-text-muted">
              Select an organization from the header to view the network topology.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
