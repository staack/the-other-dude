import { createFileRoute } from '@tanstack/react-router'
import { Wifi } from 'lucide-react'
import { WirelessLinksTable } from '@/components/wireless/WirelessLinksTable'

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantId/wireless-links',
)({
  component: WirelessLinksPage,
})

function WirelessLinksPage() {
  const { tenantId } = Route.useParams()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wifi className="h-5 w-5 text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Wireless Links</h1>
      </div>

      {/* Links table */}
      <WirelessLinksTable tenantId={tenantId} />
    </div>
  )
}
