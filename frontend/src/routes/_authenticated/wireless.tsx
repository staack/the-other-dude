import { createFileRoute } from '@tanstack/react-router'
import { Wifi } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/wireless')({
  component: WirelessPage,
})

function WirelessPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wifi className="h-5 w-5 text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Wireless</h1>
      </div>
      <p className="text-sm text-text-secondary">
        Wireless monitoring and statistics — coming soon.
      </p>
    </div>
  )
}
