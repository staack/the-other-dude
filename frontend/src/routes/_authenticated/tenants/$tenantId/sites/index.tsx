import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { SiteTable } from '@/components/sites/SiteTable'
import { SiteFormDialog } from '@/components/sites/SiteFormDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SiteResponse } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/sites/')({
  component: SitesPage,
})

function SitesPage() {
  const { tenantId } = Route.useParams()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editSite, setEditSite] = useState<SiteResponse | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sites</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Site
        </Button>
      </div>
      <Input
        placeholder="Search sites..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />
      <SiteTable
        tenantId={tenantId}
        search={search}
        onCreateClick={() => setCreateOpen(true)}
        onEditClick={setEditSite}
      />
      <SiteFormDialog open={createOpen} onOpenChange={setCreateOpen} tenantId={tenantId} />
      <SiteFormDialog
        key={editSite?.id ?? 'new'}
        open={!!editSite}
        onOpenChange={(open) => {
          if (!open) setEditSite(null)
        }}
        tenantId={tenantId}
        site={editSite}
      />
    </div>
  )
}
