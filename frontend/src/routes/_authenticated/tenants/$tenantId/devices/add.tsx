import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { tenantsApi } from '@/lib/api'
import { AddDeviceForm } from '@/components/fleet/AddDeviceForm'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/devices/add')({
  component: AddDevicePage,
})

function AddDevicePage() {
  const { tenantId } = Route.useParams()
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)

  const { data: tenant } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => tenantsApi.get(tenantId),
  })

  const handleClose = () => {
    setOpen(false)
    void navigate({ to: '/tenants/$tenantId/devices', params: { tenantId } })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <Link to="/tenants" className="hover:text-text-secondary transition-colors">
          Tenants
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link
          to="/tenants/$tenantId/devices"
          params={{ tenantId }}
          className="hover:text-text-secondary transition-colors"
        >
          {tenant?.name ?? tenantId} — Devices
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">Add Device</span>
      </div>

      <AddDeviceForm tenantId={tenantId} open={open} onClose={handleClose} />
    </div>
  )
}
