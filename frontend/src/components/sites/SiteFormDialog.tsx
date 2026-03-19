import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sitesApi, type SiteResponse, type SiteCreate, type SiteUpdate } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface SiteFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string
  site?: SiteResponse | null
}

export function SiteFormDialog({ open, onOpenChange, tenantId, site }: SiteFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = !!site

  const [name, setName] = useState(site?.name ?? '')
  const [address, setAddress] = useState(site?.address ?? '')
  const [latitude, setLatitude] = useState(site?.latitude != null ? String(site.latitude) : '')
  const [longitude, setLongitude] = useState(site?.longitude != null ? String(site.longitude) : '')
  const [elevation, setElevation] = useState(site?.elevation != null ? String(site.elevation) : '')
  const [notes, setNotes] = useState(site?.notes ?? '')

  const createMutation = useMutation({
    mutationFn: (data: SiteCreate) => sitesApi.create(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sites', tenantId] })
      onOpenChange(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: SiteUpdate) => sitesApi.update(tenantId, site!.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sites', tenantId] })
      onOpenChange(false)
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const data = {
      name: name.trim(),
      address: address.trim() || null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      elevation: elevation ? parseFloat(elevation) : null,
      notes: notes.trim() || null,
    }

    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Site' : 'Create Site'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update site details.' : 'Add a new site to organize devices by physical location.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-name">Name *</Label>
            <Input
              id="site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Main Office"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-address">Address</Label>
            <Input
              id="site-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, State"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="site-latitude">Latitude</Label>
              <Input
                id="site-latitude"
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="-33.8688"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-longitude">Longitude</Label>
              <Input
                id="site-longitude"
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="151.2093"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-elevation">Elevation (m)</Label>
            <Input
              id="site-elevation"
              type="number"
              step="any"
              value={elevation}
              onChange={(e) => setElevation(e.target.value)}
              placeholder="58"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-notes">Notes</Label>
            <textarea
              id="site-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details about this site..."
              rows={3}
              className="flex w-full rounded-md border border-border bg-elevated/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending}>
              {isEdit ? 'Save Changes' : 'Create Site'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
