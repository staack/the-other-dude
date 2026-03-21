/**
 * ServicesPanel -- IP services management panel.
 *
 * View/enable/disable RouterOS services (/ip/service),
 * edit port numbers and allowed addresses.
 * Security status indicators. Safe apply mode by default.
 */

import { useState, useCallback } from 'react'
import { Pencil, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceEntry {
  '.id': string
  name: string
  port: string
  address: string
  disabled: string
  [key: string]: string
}

interface ServiceForm {
  port: string
  address: string
  disabled: string
}

// Default ports for security indicators
const DEFAULT_PORTS: Record<string, number> = {
  api: 8728,
  'api-ssl': 8729,
  ftp: 21,
  ssh: 22,
  telnet: 23,
  winbox: 8291,
  www: 80,
  'www-ssl': 443,
}

// ---------------------------------------------------------------------------
// Panel type shorthand
// ---------------------------------------------------------------------------

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// ServicesPanel
// ---------------------------------------------------------------------------

export function ServicesPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId,
    deviceId,
    '/ip/service',
    { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'services')
  const [previewOpen, setPreviewOpen] = useState(false)

  const typedEntries = entries as ServiceEntry[]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
        Loading IP services...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-error text-sm">
        Failed to load services.{' '}
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

      <ServiceTable entries={typedEntries} panel={panel} />

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
// Security indicator
// ---------------------------------------------------------------------------

function SecurityIndicator({ entry }: { entry: ServiceEntry }) {
  if (entry.disabled === 'true') {
    return (
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-success" />
        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">
          disabled
        </span>
      </div>
    )
  }

  const port = parseInt(entry.port, 10)
  const defaultPort = DEFAULT_PORTS[entry.name]
  const isDefaultPort = defaultPort && port === defaultPort
  const hasRestriction = entry.address && entry.address !== '' && entry.address !== '0.0.0.0/0'

  if (isDefaultPort && !hasRestriction) {
    return (
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5 text-warning" />
        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-warning/10 text-warning border-warning/40">
          default port
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Shield className="h-3.5 w-3.5 text-info" />
      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-info/10 text-info border-info/40">
        enabled
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Service Table
// ---------------------------------------------------------------------------

function ServiceTable({
  entries,
  panel,
}: {
  entries: ServiceEntry[]
  panel: PanelHook
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceEntry | null>(null)
  const [form, setForm] = useState<ServiceForm>({ port: '', address: '', disabled: 'false' })

  const handleEdit = useCallback((entry: ServiceEntry) => {
    setEditing(entry)
    setForm({
      port: entry.port || '',
      address: entry.address || '',
      disabled: entry.disabled || 'false',
    })
    setDialogOpen(true)
  }, [])

  const handleToggle = useCallback(
    (entry: ServiceEntry) => {
      const newState = entry.disabled === 'true' ? 'false' : 'true'
      panel.addChange({
        operation: 'set',
        path: '/ip/service',
        entryId: entry['.id'],
        properties: { disabled: newState },
        description: `${newState === 'true' ? 'Disable' : 'Enable'} service "${entry.name}"`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    if (!editing) return
    const props: Record<string, string> = {}
    if (form.port && form.port !== editing.port) props.port = form.port
    if (form.address !== editing.address) props.address = form.address
    if (form.disabled !== editing.disabled) props.disabled = form.disabled

    if (Object.keys(props).length === 0) {
      setDialogOpen(false)
      return
    }

    panel.addChange({
      operation: 'set',
      path: '/ip/service',
      entryId: editing['.id'],
      properties: props,
      description: `Edit service "${editing.name}" (${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', ')})`,
    })
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Shield className="h-4 w-4" />
            IP Services ({entries.length})
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">No services found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Service</th>
                  <th className="text-left px-4 py-2 font-medium">Port</th>
                  <th className="text-left px-4 py-2 font-medium">Allowed From</th>
                  <th className="text-left px-4 py-2 font-medium">Security</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry['.id']}
                    className={cn(
                      'border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors',
                      entry.disabled === 'true' && 'opacity-50',
                    )}
                  >
                    <td className="px-4 py-2 text-text-primary font-medium">
                      {entry.name || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {entry.port || '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary text-xs">
                      {entry.address || 'any'}
                    </td>
                    <td className="px-4 py-2">
                      <SecurityIndicator entry={entry} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleToggle(entry)}
                        >
                          {entry.disabled === 'true' ? 'Enable' : 'Disable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleEdit(entry)}
                          title="Edit service"
                        >
                          <Pencil className="h-3.5 w-3.5" />
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
            <DialogTitle>Edit Service: {editing?.name}</DialogTitle>
            <DialogDescription>
              Modify port and access restrictions. Changes are staged until you apply.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Port</Label>
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                className="h-8 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Allowed Addresses</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="0.0.0.0/0 (any)"
                className="h-8 text-sm font-mono"
              />
              <p className="text-xs text-text-muted">
                Comma-separated CIDRs. Empty = allow from any.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Status</Label>
              <select
                value={form.disabled}
                onChange={(e) => setForm((f) => ({ ...f, disabled: e.target.value }))}
                className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary"
              >
                <option value="false">Enabled</option>
                <option value="true">Disabled</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Stage Change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
