/**
 * ScriptsPanel -- Scripts & scheduler management panel.
 *
 * Sub-tabs:
 * 1. Scripts -- view/add/edit/delete scripts with monospace editor and run button
 * 2. Scheduler -- view/add/edit/delete scheduler entries
 *
 * Standard apply mode by default.
 */

import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Play, Code, Clock } from 'lucide-react'
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
import { SafetyToggle } from './SafetyToggle'
import { ChangePreviewModal } from './ChangePreviewModal'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { configEditorApi } from '@/lib/configEditorApi'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Sub-tab types
// ---------------------------------------------------------------------------

type SubTab = 'scripts' | 'scheduler'

const SUB_TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: 'scripts', label: 'Scripts', icon: <Code className="h-3.5 w-3.5" /> },
  { key: 'scheduler', label: 'Scheduler', icon: <Clock className="h-3.5 w-3.5" /> },
]

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

interface ScriptEntry {
  '.id': string
  name: string
  source: string
  owner: string
  'last-started': string
  'run-count': string
  [key: string]: string
}

interface SchedulerEntry {
  '.id': string
  name: string
  'start-time': string
  interval: string
  'on-event': string
  disabled: string
  'next-run': string
  [key: string]: string
}

// ---------------------------------------------------------------------------
// Form types
// ---------------------------------------------------------------------------

interface ScriptForm {
  name: string
  source: string
}

interface SchedulerForm {
  name: string
  'start-time': string
  interval: string
  'on-event': string
}

const EMPTY_SCRIPT: ScriptForm = { name: '', source: '' }
const EMPTY_SCHEDULER: SchedulerForm = { name: '', 'start-time': 'startup', interval: '00:00:00', 'on-event': '' }

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// ScriptsPanel
// ---------------------------------------------------------------------------

export function ScriptsPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('scripts')

  const scripts = useConfigBrowse(tenantId, deviceId, '/system/script', { enabled: active })
  const scheduler = useConfigBrowse(tenantId, deviceId, '/system/scheduler', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'scripts')
  const [previewOpen, setPreviewOpen] = useState(false)

  const isLoading = scripts.isLoading || scheduler.isLoading
  const hasError = scripts.error || scheduler.error

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading scripts & scheduler...
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load scripts.{' '}
        <button className="underline ml-1" onClick={() => { scripts.refetch(); scheduler.refetch() }}>
          Retry
        </button>
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

      {/* Sub-tab navigation */}
      <div className="flex gap-1 p-1 rounded-lg bg-elevated">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface/50',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'scripts' && (
        <ScriptsTab
          entries={scripts.entries as ScriptEntry[]}
          panel={panel}
          tenantId={tenantId}
          deviceId={deviceId}
        />
      )}
      {activeTab === 'scheduler' && (
        <SchedulerTab
          entries={scheduler.entries as SchedulerEntry[]}
          panel={panel}
        />
      )}

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
// Scripts Tab
// ---------------------------------------------------------------------------

function ScriptsTab({
  entries,
  panel,
  tenantId,
  deviceId,
}: {
  entries: ScriptEntry[]
  panel: PanelHook
  tenantId: string
  deviceId: string
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ScriptEntry | null>(null)
  const [form, setForm] = useState<ScriptForm>(EMPTY_SCRIPT)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const runMutation = useMutation({
    mutationFn: (scriptName: string) =>
      configEditorApi.execute(tenantId, deviceId, `/system script run ${scriptName}`),
    onSuccess: (_data, scriptName) => {
      toast.success(`Script "${scriptName}" executed`)
    },
    onError: (err: Error, scriptName) => {
      toast.error(`Failed to run "${scriptName}"`, { description: err.message })
    },
  })

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_SCRIPT)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: ScriptEntry) => {
    setEditing(entry)
    setForm({ name: entry.name || '', source: entry.source || '' })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: ScriptEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/system/script',
        entryId: entry['.id'],
        properties: {},
        description: `Remove script "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!form.name) errs.name = 'Script name is required'
    if (!form.source) errs.source = 'Script source is required'
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    const props: Record<string, string> = { name: form.name, source: form.source }

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/system/script',
        entryId: editing['.id'],
        properties: props,
        description: `Edit script "${form.name}"`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/system/script',
        properties: props,
        description: `Add script "${form.name}"`,
      })
    }
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Code className="h-4 w-4" />
            Scripts ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Script
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">No scripts found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Owner</th>
                  <th className="text-left px-4 py-2 font-medium">Last Run</th>
                  <th className="text-left px-4 py-2 font-medium">Run Count</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
                    <td className="px-4 py-2 text-text-primary font-medium">{entry.name || '—'}</td>
                    <td className="px-4 py-2 text-text-secondary">{entry.owner || '—'}</td>
                    <td className="px-4 py-2 text-text-muted text-xs">{entry['last-started'] || '—'}</td>
                    <td className="px-4 py-2 text-text-secondary">{entry['run-count'] || '0'}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() => runMutation.mutate(entry.name)}
                          disabled={runMutation.isPending}
                          title="Run script"
                        >
                          <Play className="h-3 w-3" />
                          Run
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(entry)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(entry)} title="Delete">
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Script' : 'Add Script'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Modify the script. Changes are staged until you apply.' : 'Create a new RouterOS script.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Script Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="my-script"
                className={cn('h-8 text-sm', errors.name && 'border-error')}
              />
              {errors.name && <p className="text-xs text-error">{errors.name}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Source</Label>
              <textarea
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder=":log info &quot;Hello from script&quot;"
                rows={10}
                className={cn(
                  'w-full rounded-md border bg-elevated px-3 py-2 text-sm font-mono text-text-primary resize-y',
                  errors.source ? 'border-error' : 'border-border',
                )}
              />
              {errors.source && <p className="text-xs text-error">{errors.source}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Script'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Scheduler Tab
// ---------------------------------------------------------------------------

function SchedulerTab({
  entries,
  panel,
}: {
  entries: SchedulerEntry[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SchedulerEntry | null>(null)
  const [form, setForm] = useState<SchedulerForm>(EMPTY_SCHEDULER)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleAdd = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_SCHEDULER)
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: SchedulerEntry) => {
    setEditing(entry)
    setForm({
      name: entry.name || '',
      'start-time': entry['start-time'] || 'startup',
      interval: entry.interval || '00:00:00',
      'on-event': entry['on-event'] || '',
    })
    setErrors({})
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: SchedulerEntry) => {
      panel.addChange({
        operation: 'remove',
        path: '/system/scheduler',
        entryId: entry['.id'],
        properties: {},
        description: `Remove scheduler "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleToggle = useCallback(
    (entry: SchedulerEntry) => {
      const newState = entry.disabled === 'true' ? 'false' : 'true'
      panel.addChange({
        operation: 'set',
        path: '/system/scheduler',
        entryId: entry['.id'],
        properties: { disabled: newState },
        description: `${newState === 'true' ? 'Disable' : 'Enable'} scheduler "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!form.name) errs.name = 'Name is required'
    if (!form['on-event']) errs['on-event'] = 'On-event script is required'
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    const props: Record<string, string> = {
      name: form.name,
      'start-time': form['start-time'],
      interval: form.interval,
      'on-event': form['on-event'],
    }

    if (editing) {
      panel.addChange({
        operation: 'set',
        path: '/system/scheduler',
        entryId: editing['.id'],
        properties: props,
        description: `Edit scheduler "${form.name}"`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/system/scheduler',
        properties: props,
        description: `Add scheduler "${form.name}" (interval: ${form.interval})`,
      })
    }
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Clock className="h-4 w-4" />
            Scheduler ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add Entry
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">No scheduler entries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Start Time</th>
                  <th className="text-left px-4 py-2 font-medium">Interval</th>
                  <th className="text-left px-4 py-2 font-medium">On Event</th>
                  <th className="text-left px-4 py-2 font-medium">Next Run</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
                    <td className="px-4 py-2 text-text-primary font-medium">{entry.name || '—'}</td>
                    <td className="px-4 py-2 text-text-secondary">{entry['start-time'] || '—'}</td>
                    <td className="px-4 py-2 font-mono text-text-secondary">{entry.interval || '—'}</td>
                    <td className="px-4 py-2 text-text-secondary text-xs max-w-[200px] truncate" title={entry['on-event']}>
                      {entry['on-event'] || '—'}
                    </td>
                    <td className="px-4 py-2 text-text-muted text-xs">{entry['next-run'] || '—'}</td>
                    <td className="px-4 py-2">
                      {entry.disabled === 'true' ? (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">disabled</span>
                      ) : (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">active</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleToggle(entry)}>
                          {entry.disabled === 'true' ? 'Enable' : 'Disable'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(entry)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(entry)} title="Delete">
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
            <DialogTitle>{editing ? 'Edit Scheduler' : 'Add Scheduler Entry'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Modify the scheduler entry.' : 'Create a new scheduler entry. Changes are staged until you apply.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="daily-backup"
                className={cn('h-8 text-sm', errors.name && 'border-error')}
              />
              {errors.name && <p className="text-xs text-error">{errors.name}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Start Time</Label>
                <Input
                  value={form['start-time']}
                  onChange={(e) => setForm((f) => ({ ...f, 'start-time': e.target.value }))}
                  placeholder="startup"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Interval</Label>
                <Input
                  value={form.interval}
                  onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value }))}
                  placeholder="1d 00:00:00"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">On Event (script name or commands)</Label>
              <Input
                value={form['on-event']}
                onChange={(e) => setForm((f) => ({ ...f, 'on-event': e.target.value }))}
                placeholder="backup-script"
                className={cn('h-8 text-sm', errors['on-event'] && 'border-error')}
              />
              {errors['on-event'] && <p className="text-xs text-error">{errors['on-event']}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Entry'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
