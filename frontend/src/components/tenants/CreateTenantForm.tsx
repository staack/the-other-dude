import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantsApi } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateTenantForm({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => tenantsApi.create({ name, description: description || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: `Tenant "${name}" created` })
      handleClose()
    },
    onError: () => {
      setError('Failed to create tenant. Please try again.')
    },
  })

  const handleClose = () => {
    setName('')
    setDescription('')
    setError(null)
    onClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Tenant name is required')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Tenant</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tenant-name">Name *</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-desc">Description</Label>
            <Input
              id="tenant-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} size="sm">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create Tenant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
