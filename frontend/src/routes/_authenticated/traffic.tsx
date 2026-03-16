import { createFileRoute } from '@tanstack/react-router'
import { BarChart3 } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/traffic')({
  component: TrafficPage,
})

function TrafficPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Traffic</h1>
      </div>
      <p className="text-sm text-text-secondary">
        Bandwidth monitoring and traffic analysis — coming soon.
      </p>
    </div>
  )
}
