/**
 * AddressListPanel -- Firewall address lists management.
 *
 * View/add/edit/delete address list entries (/ip/firewall/address-list),
 * grouped by list name with collapsible sections, timeout display,
 * bulk import. Standard apply mode by default.
 */

import { useState, useCallback, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, List, Upload } from 'lucide-react'
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

interface AddressListEntry {
  '.id': string
  list: string
  address: string
  timeout: string
  dynamic: string
  disabled: string
  comment: string
  [key: string]: string
}

interface AddressListForm {
  list: string
  address: string
  comment: string
}

const EMPTY_FORM: AddressListForm = { list: '', address: '', comment: '' }

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// AddressListPanel
// ---------------------------------------------------------------------------

export function AddressListPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const { entries, isLoading, error, refetch } = useConfigBrowse(
    tenantId, deviceId, '/ip/firewall/address-list', { enabled: active },
  )
  const panel = useConfigPanel(tenantId, deviceId, 'address-lists')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [form, setForm] = useState<AddressListForm>(EMPTY_FORM)
  const [bulkList, setBulkList] = useState('')
  const [bulkAddresses, setBulkAddresses] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const typedEntries = entries as AddressListEntry[]

  // Group by list name
  const grouped = useMemo(() => {
    const map = new Map<string, AddressListEntry[]>()
    typedEntries.forEach((e) => {
      const list = e.list || 'unknown'
      if (!map.has(list)) map.set(list, [])
      map.get(list)!.push(e)
    })
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [typedEntries])

  const listNames = useMemo(() => grouped.map(([name]) => name), [grouped])

  const toggleCollapse = useCallback((name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const handleAdd = useCallback(() => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: AddressListEntry) => {
      panel.addChange({
        operation: 'remove', path: '/ip/firewall/address-list',
        entryId: entry['.id'], properties: {},
        description: `Remove ${entry.address} from list "${entry.list}"`,
      })
    },
    [panel],
  )

  const handleSave = useCallback(() => {
    if (!form.list || !form.address) return
    const props: Record<string, string> = { list: form.list, address: form.address }
    if (form.comment) props.comment = form.comment
    panel.addChange({
      operation: 'add', path: '/ip/firewall/address-list', properties: props,
      description: `Add ${form.address} to list "${form.list}"`,
    })
    setDialogOpen(false)
  }, [form, panel])

  const handleBulkImport = useCallback(() => {
    if (!bulkList || !bulkAddresses.trim()) return
    const addresses = bulkAddresses.split('\n').map((a) => a.trim()).filter(Boolean)
    addresses.forEach((addr) => {
      panel.addChange({
        operation: 'add', path: '/ip/firewall/address-list',
        properties: { list: bulkList, address: addr },
        description: `Add ${addr} to list "${bulkList}"`,
      })
    })
    setBulkOpen(false)
    setBulkAddresses('')
  }, [bulkList, bulkAddresses, panel])

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading address lists...</div>
  }
  if (error) {
    return <div className="flex items-center justify-center py-12 text-error text-sm">Failed to load address lists. <button className="underline ml-1" onClick={() => refetch()}>Retry</button></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
        <Button size="sm" disabled={panel.pendingChanges.length === 0 || panel.isApplying} onClick={() => setPreviewOpen(true)}>
          Review & Apply ({panel.pendingChanges.length})
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <List className="h-4 w-4" />
            Address Lists ({typedEntries.length} entries, {grouped.length} lists)
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setBulkOpen(true)}>
              <Upload className="h-3.5 w-3.5" />
              Bulk Import
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
              <Plus className="h-3.5 w-3.5" />
              Add Entry
            </Button>
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">No address list entries found.</div>
        ) : (
          <div>
            {grouped.map(([listName, listEntries]) => (
              <div key={listName} className="border-b border-border/30 last:border-0">
                <button
                  onClick={() => toggleCollapse(listName)}
                  className="w-full flex items-center gap-2 px-4 py-2 hover:bg-elevated/50 transition-colors text-left"
                >
                  {collapsed.has(listName) ? <ChevronRight className="h-3.5 w-3.5 text-text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-text-muted" />}
                  <span className="text-sm font-medium text-text-primary">{listName}</span>
                  <span className="text-xs text-text-muted">({listEntries.length})</span>
                </button>
                {!collapsed.has(listName) && (
                  <div className="px-4 pb-2">
                    <table className="w-full text-sm">
                      <tbody>
                        {listEntries.map((entry) => (
                          <tr key={entry['.id']} className="hover:bg-elevated/30 transition-colors">
                            <td className="py-1 pl-6 font-mono text-text-primary text-xs">{entry.address}</td>
                            <td className="py-1 text-text-muted text-xs">{entry.timeout || '—'}</td>
                            <td className="py-1">
                              {entry.dynamic === 'true'
                                ? <span className="text-[10px] px-1 rounded bg-elevated text-text-muted border border-border">dynamic</span>
                                : <span className="text-[10px] px-1 rounded bg-success/10 text-success border border-success/40">static</span>}
                            </td>
                            <td className="py-1 text-text-muted text-xs">{entry.comment || ''}</td>
                            <td className="py-1 text-right">
                              {entry.dynamic !== 'true' && (
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-error hover:text-error" onClick={() => handleDelete(entry)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add single entry dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Address List Entry</DialogTitle>
            <DialogDescription>Add an address to a firewall address list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">List Name</Label>
              <Input value={form.list} onChange={(e) => setForm((f) => ({ ...f, list: e.target.value }))} placeholder="blocklist" className="h-8 text-sm" list="list-names" />
              <datalist id="list-names">{listNames.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Address</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="192.168.1.0/24" className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Comment</Label>
              <Input value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="optional" className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.list || !form.address}>Stage Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk import dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Import Addresses</DialogTitle>
            <DialogDescription>Paste one address per line to add them all to a list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">List Name</Label>
              <Input value={bulkList} onChange={(e) => setBulkList(e.target.value)} placeholder="blocklist" className="h-8 text-sm" list="bulk-list-names" />
              <datalist id="bulk-list-names">{listNames.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Addresses (one per line)</Label>
              <textarea
                value={bulkAddresses}
                onChange={(e) => setBulkAddresses(e.target.value)}
                placeholder={"192.168.1.0/24\n10.0.0.0/8\n172.16.0.0/12"}
                rows={8}
                className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm font-mono text-text-primary resize-y"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkImport} disabled={!bulkList || !bulkAddresses.trim()}>
              Stage {bulkAddresses.split('\n').filter((a) => a.trim()).length} Entries
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}
