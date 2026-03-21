/**
 * ManglePanel -- Firewall mangle rules management.
 *
 * View/add/edit/delete mangle rules (/ip/firewall/mangle),
 * chain selector, action types, move up/down for rule ordering.
 * Safe apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Filter } from 'lucide-react'
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
// Types
// ---------------------------------------------------------------------------

type ChainFilter = 'all' | 'prerouting' | 'input' | 'forward' | 'output' | 'postrouting'

const CHAINS: ChainFilter[] = ['all', 'prerouting', 'input', 'forward', 'output', 'postrouting']
const ACTIONS = ['mark-connection', 'mark-packet', 'mark-routing', 'change-dscp', 'passthrough', 'accept', 'drop', 'jump', 'log']

interface MangleEntry {
  '.id': string
  chain: string
  action: string
  'new-connection-mark': string
  'new-packet-mark': string
  'new-routing-mark': string
  'src-address': string
  'dst-address': string
  protocol: string
  'dst-port': string
  'src-port': string
  disabled: string
  comment: string
  [key: string]: string
}

interface MangleForm {
  chain: string
  action: string
  'src-address': string
  'dst-address': string
  protocol: string
  'dst-port': string
  'new-connection-mark': string
  'new-packet-mark': string
  'new-routing-mark': string
  comment: string
}

const EMPTY_FORM: MangleForm = {
  chain: 'prerouting',
  action: 'mark-connection',
  'src-address': '',
  'dst-address': '',
  protocol: '',
  'dst-port': '',
  'new-connection-mark': '',
  'new-packet-mark': '',
  'new-routing-mark': '',
  comment: '',
}

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// ManglePanel
// ---------------------------------------------------------------------------

export function ManglePanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId, deviceId, '/ip/firewall/mangle', { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'mangle')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [chainFilter, setChainFilter] = useState<ChainFilter>('all')

  const typedEntries = entries as MangleEntry[]
  const filtered = useMemo(() => {
    if (chainFilter === 'all') return typedEntries
    return typedEntries.filter((e) => e.chain === chainFilter)
  }, [typedEntries, chainFilter])

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading mangle rules...</div>
  }
  if (error) {
    return <div className="flex items-center justify-center py-12 text-error text-sm">Failed to load mangle rules. <button className="underline ml-1" onClick={() => refetch()}>Retry</button></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button size="sm" disabled={panel.pendingChanges.length === 0 || panel.isApplying} onClick={() => setPreviewOpen(true)}>
          Review & Apply ({panel.pendingChanges.length})
        </Button>
      </div>

      <div className="flex gap-1 p-1 rounded-lg bg-elevated">
        {CHAINS.map((chain) => (
          <button
            key={chain}
            onClick={() => setChainFilter(chain)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
              chainFilter === chain ? 'bg-panel text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-panel/50',
            )}
          >
            {chain}
          </button>
        ))}
      </div>

      <MangleTable entries={filtered} panel={panel} />

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mangle Table
// ---------------------------------------------------------------------------

function MangleTable({ entries, panel }: { entries: MangleEntry[]; panel: PanelHook }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MangleEntry | null>(null)
  const [form, setForm] = useState<MangleForm>(EMPTY_FORM)

  const handleAdd = useCallback(() => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }, [])
  const handleEdit = useCallback((e: MangleEntry) => {
    setEditing(e)
    setForm({
      chain: e.chain || 'prerouting', action: e.action || 'mark-connection',
      'src-address': e['src-address'] || '', 'dst-address': e['dst-address'] || '',
      protocol: e.protocol || '', 'dst-port': e['dst-port'] || '',
      'new-connection-mark': e['new-connection-mark'] || '',
      'new-packet-mark': e['new-packet-mark'] || '',
      'new-routing-mark': e['new-routing-mark'] || '',
      comment: e.comment || '',
    })
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback((e: MangleEntry) => {
    panel.addChange({ operation: 'remove', path: '/ip/firewall/mangle', entryId: e['.id'], properties: {}, description: `Remove mangle rule ${e.chain}/${e.action} ${e.comment || ''}`.trim() })
  }, [panel])

  const handleSave = useCallback(() => {
    if (!form.chain || !form.action) return
    const props: Record<string, string> = { chain: form.chain, action: form.action }
    if (form['src-address']) props['src-address'] = form['src-address']
    if (form['dst-address']) props['dst-address'] = form['dst-address']
    if (form.protocol) props.protocol = form.protocol
    if (form['dst-port']) props['dst-port'] = form['dst-port']
    if (form['new-connection-mark']) props['new-connection-mark'] = form['new-connection-mark']
    if (form['new-packet-mark']) props['new-packet-mark'] = form['new-packet-mark']
    if (form['new-routing-mark']) props['new-routing-mark'] = form['new-routing-mark']
    if (form.comment) props.comment = form.comment

    if (editing) {
      panel.addChange({ operation: 'set', path: '/ip/firewall/mangle', entryId: editing['.id'], properties: props, description: `Edit mangle ${form.chain}/${form.action}` })
    } else {
      panel.addChange({ operation: 'add', path: '/ip/firewall/mangle', properties: props, description: `Add mangle ${form.chain}/${form.action} ${form.comment || ''}`.trim() })
    }
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Filter className="h-4 w-4" />
            Mangle Rules ({entries.length})
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}><Plus className="h-3.5 w-3.5" />Add Rule</Button>
        </div>

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">No mangle rules found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-secondary text-xs">
                  <th className="text-left px-4 py-2 font-medium">Chain</th>
                  <th className="text-left px-4 py-2 font-medium">Src Address</th>
                  <th className="text-left px-4 py-2 font-medium">Dst Address</th>
                  <th className="text-left px-4 py-2 font-medium">Protocol</th>
                  <th className="text-left px-4 py-2 font-medium">Action</th>
                  <th className="text-left px-4 py-2 font-medium">Mark</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry['.id']} className={cn('border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors', entry.disabled === 'true' && 'opacity-50')}>
                    <td className="px-4 py-2 text-text-primary">{entry.chain}</td>
                    <td className="px-4 py-2 font-mono text-text-secondary text-xs">{entry['src-address'] || 'any'}</td>
                    <td className="px-4 py-2 font-mono text-text-secondary text-xs">{entry['dst-address'] || 'any'}</td>
                    <td className="px-4 py-2 text-text-secondary">{entry.protocol || 'any'}</td>
                    <td className="px-4 py-2"><span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-info/10 text-info border-info/40">{entry.action}</span></td>
                    <td className="px-4 py-2 text-text-muted text-xs">{entry['new-connection-mark'] || entry['new-packet-mark'] || entry['new-routing-mark'] || '—'}</td>
                    <td className="px-4 py-2">
                      {entry.disabled === 'true'
                        ? <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">disabled</span>
                        : <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">active</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(entry)} title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(entry)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Mangle Rule' : 'Add Mangle Rule'}</DialogTitle>
            <DialogDescription>Configure the mangle rule properties. Changes are staged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Chain</Label>
                <Select value={form.chain} onValueChange={(v) => setForm((f) => ({ ...f, chain: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{CHAINS.filter((c) => c !== 'all').map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Action</Label>
                <Select value={form.action} onValueChange={(v) => setForm((f) => ({ ...f, action: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Src Address</Label>
                <Input value={form['src-address']} onChange={(e) => setForm((f) => ({ ...f, 'src-address': e.target.value }))} placeholder="any" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Dst Address</Label>
                <Input value={form['dst-address']} onChange={(e) => setForm((f) => ({ ...f, 'dst-address': e.target.value }))} placeholder="any" className="h-8 text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Protocol</Label>
                <Input value={form.protocol} onChange={(e) => setForm((f) => ({ ...f, protocol: e.target.value }))} placeholder="tcp" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Dst Port</Label>
                <Input value={form['dst-port']} onChange={(e) => setForm((f) => ({ ...f, 'dst-port': e.target.value }))} placeholder="80,443" className="h-8 text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Conn. Mark</Label>
                <Input value={form['new-connection-mark']} onChange={(e) => setForm((f) => ({ ...f, 'new-connection-mark': e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Packet Mark</Label>
                <Input value={form['new-packet-mark']} onChange={(e) => setForm((f) => ({ ...f, 'new-packet-mark': e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Routing Mark</Label>
                <Input value={form['new-routing-mark']} onChange={(e) => setForm((f) => ({ ...f, 'new-routing-mark': e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Comment</Label>
              <Input value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="optional" className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Rule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
