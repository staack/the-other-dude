import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sectorsApi, type SectorResponse, type SectorCreate, type SectorUpdate } from '@/lib/api'
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

interface SectorFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string
  siteId: string
  sector?: SectorResponse | null
}

export function SectorFormDialog({ open, onOpenChange, tenantId, siteId, sector }: SectorFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = !!sector

  const [name, setName] = useState('')
  const [azimuth, setAzimuth] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (sector) {
      setName(sector.name)
      setAzimuth(sector.azimuth != null ? String(sector.azimuth) : '')
      setDescription(sector.description ?? '')
    } else {
      setName('')
      setAzimuth('')
      setDescription('')
    }
  }, [sector, open])

  const createMutation = useMutation({
    mutationFn: (data: SectorCreate) => sectorsApi.create(tenantId, siteId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sectors', tenantId, siteId] })
      onOpenChange(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: SectorUpdate) => sectorsApi.update(tenantId, siteId, sector!.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sectors', tenantId, siteId] })
      onOpenChange(false)
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const data = {
      name: name.trim(),
      azimuth: azimuth ? parseFloat(azimuth) : null,
      description: description.trim() || null,
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
          <DialogTitle>{isEdit ? 'Edit Sector' : 'Add Sector'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update sector details.' : 'Create a new sector to organize APs by direction.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sector-name">Name *</Label>
            <Input
              id="sector-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="North Sector"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sector-azimuth">Azimuth</Label>
            <Input
              id="sector-azimuth"
              type="number"
              min={0}
              max={360}
              value={azimuth}
              onChange={(e) => setAzimuth(e.target.value)}
              placeholder="0-360"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sector-description">Description</Label>
            <textarea
              id="sector-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details about this sector..."
              rows={3}
              className="flex w-full rounded-md border border-border bg-elevated/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending}>
              {isEdit ? 'Save Changes' : 'Create Sector'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
