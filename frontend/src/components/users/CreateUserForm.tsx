import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface Props {
  tenantId: string
  open: boolean
  onClose: () => void
}

export function CreateUserForm({ tenantId, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'viewer' })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => usersApi.create(tenantId, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast({ title: `User "${form.email}" created` })
      handleClose()
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Failed to create user'
      setError(msg)
    },
  })

  const handleClose = () => {
    setForm({ name: '', email: '', password: '', role: 'viewer' })
    setError(null)
    onClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setError('All fields are required')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Full Name *</Label>
            <Input
              id="user-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email *</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jane@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-password">Password *</Label>
            <Input
              id="user-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Min. 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-role">Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
            >
              <SelectTrigger id="user-role">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant_admin">Admin</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-error" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} size="sm">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Add User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
