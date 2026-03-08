/**
 * UsersPanel -- RouterOS user management panel.
 *
 * View/add/edit/delete RouterOS users (/user), group assignment
 * with permission display (/user/group), password change.
 * Safe apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Users, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SafetyToggle } from './SafetyToggle'
import { ChangePreviewModal } from './ChangePreviewModal'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Entry & form types
// ---------------------------------------------------------------------------

interface UserEntry {
  '.id': string
  name: string
  group: string
  'allowed-address': string
  'last-logged-in': string
  disabled: string
  [key: string]: string
}

interface GroupEntry {
  '.id': string
  name: string
  policy: string
  [key: string]: string
}

interface UserForm {
  name: string
  group: string
  password: string
  'allowed-address': string
}

const EMPTY_FORM: UserForm = {
  name: '',
  group: 'read',
  password: '',
  'allowed-address': '',
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateUserForm(form: UserForm, isEditing: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.name) {
    errors.name = 'Username is required'
  }
  if (!form.group) {
    errors.group = 'Group is required'
  }
  if (!isEditing && !form.password) {
    errors.password = 'Password is required for new users'
  }
  return errors
}

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// UsersPanel
// ---------------------------------------------------------------------------

export function UsersPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/user',
    { enabled: active },
  )
  const { entries: groupEntries } = useConfigBrowse(
    tenantId,
    deviceId,
    '/user/group',
    { enabled: active },
  )

  const panel = useConfigPanel(tenantId, deviceId, 'users')
  const [previewOpen, setPreviewOpen] = useState(false)

  const typedEntries = entries as UserEntry[]
  const groups = groupEntries as GroupEntry[]
  const groupNames = useMemo(() => groups.map((g) => g.name).filter(Boolean), [groups])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading RouterOS users...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load users.{' '}
        <button className="underline ml-1" onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button
          size="sm"
          disabled={panel.pendingChanges.length === 0 || panel.isApplying}
          onClick={() => setPreviewOpen(true)}
        >
          Review & Apply ({panel.pendingChanges.length})
        </Button>
      </div>

      {/* Groups overview */}
      {groups.length > 0 && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2">
            <Shield className="h-4 w-4 text-text-muted" />
            <span className="text-sm font-medium text-text-secondary">User Groups</span>
          </div>
          <div className="px-4 py-3 space-y-1.5">
            {groups.map((g) => (
              <div key={g['.id']} className="flex items-start gap-3">
                <span className="text-sm text-text-primary font-medium w-20">{g.name}</span>
                <span className="text-xs text-text-muted font-mono break-all">{g.policy || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <UsersTable entries={typedEntries} panel={panel} groupNames={groupNames} />

      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={() => {
          panel.applyChanges()
          setPreviewOpen(false)
        }}
        isApplying={panel.isApplying}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Users Table
// ---------------------------------------------------------------------------

function UsersTable({
  entries,
  panel,
  groupNames,
}: {
  entries: UserEntry[]
  panel: PanelHook
  groupNames: string[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<UserEntry | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: UserEntry) => {
    setEditing(entry)
    setForm({
      name: entry.name || '',
      group: entry.group || 'read',
      password: '',
      'allowed-address': entry['allowed-address'] || '',
    })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: UserEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/user',
        entryId: entry['.id'],
        properties: {},
        description: `Remove user "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const validationErrors = validateUserForm(form, !!editing)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const props: Record<string, string> = {
      name: form.name,
      group: form.group,
    }
    if (form.password) props.password = form.password
    if (form['allowed-address']) props['allowed-address'] = form['allowed-address']

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/user',
        entryId: editing['.id'],
        properties: props,
        description: `Edit user "${form.name}" (group: ${form.group})`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/user',
        properties: props,
        description: `Add user "${form.name}" (group: ${form.group})`,
      })
    }
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Users className="h-4 w-4" />
            RouterOS Users ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add User
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Group</th>
                  <th className="text-left px-4 py-2 font-medium">Allowed Address</th>
                  <th className="text-left px-4 py-2 font-medium">Last Login</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry['.id']}
                    className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors"
                  >
                    <td className="px-4 py-2 text-text-primary font-medium">{entry.name || '—'}</td>
                    <td className="px-4 py-2">
                      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-info/10 text-info border-info/40">
                        {entry.group || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary text-xs">
                      {entry['allowed-address'] || 'any'}
                    </td>
                    <td className="px-4 py-2 text-text-muted text-xs">
                      {entry['last-logged-in'] || '—'}
                    </td>
                    <td className="px-4 py-2">
                      {entry.disabled === 'true' ? (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">
                          disabled
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">
                          active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(entry)} title="Edit user">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(entry)} title="Delete user">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit User' : 'Add User'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Modify the user. Leave password blank to keep unchanged.' : 'Create a new RouterOS user. Changes are staged until you apply.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Username</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="admin"
                className={cn('h-8 text-sm', errors.name && 'border-error')}
              />
              {errors.name && <p className="text-xs text-error">{errors.name}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Group</Label>
              {groupNames.length > 0 ? (
                <Select value={form.group} onValueChange={(v) => setForm((f) => ({ ...f, group: v }))}>
                  <SelectTrigger className={cn('h-8 text-sm', errors.group && 'border-error')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groupNames.map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.group}
                  onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                  placeholder="full"
                  className={cn('h-8 text-sm', errors.group && 'border-error')}
                />
              )}
              {errors.group && <p className="text-xs text-error">{errors.group}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">
                Password {editing && '(leave blank to keep)'}
              </Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editing ? 'unchanged' : 'required'}
                className={cn('h-8 text-sm', errors.password && 'border-error')}
              />
              {errors.password && <p className="text-xs text-error">{errors.password}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Allowed Address</Label>
              <Input
                value={form['allowed-address']}
                onChange={(e) => setForm((f) => ({ ...f, 'allowed-address': e.target.value }))}
                placeholder="0.0.0.0/0 (any)"
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage User'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
