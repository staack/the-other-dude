/**
 * FirewallBasicsPanel -- Simple mode firewall configuration.
 *
 * Shows input and forward chain rules in separate sections with simplified views.
 * Also displays address lists grouped by list name.
 * Allows adding basic allow/block rules without exposing full firewall complexity.
 */

import { useState } from 'react'
import { Shield, Network, List, Plus, Pencil, Trash2, Power, PowerOff, ChevronDown, ChevronRight } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'
import { cn } from '@/lib/utils'

// ---- Types ----

interface RuleForm {
  chain: string
  action: string
  protocol: string
  'dst-port': string
  'src-address': string
  comment: string
  disabled: string
}

interface AddressListForm {
  list: string
  address: string
  comment: string
}

const EMPTY_RULE: RuleForm = {
  chain: 'input',
  action: 'accept',
  protocol: 'any',
  'dst-port': '',
  'src-address': '',
  comment: '',
  disabled: 'false',
}

const EMPTY_ADDR: AddressListForm = {
  list: '',
  address: '',
  comment: '',
}

const ACTION_OPTIONS = [
  { value: 'accept', label: 'Accept' },
  { value: 'drop', label: 'Drop' },
  { value: 'reject', label: 'Reject' },
]

const PROTOCOL_OPTIONS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'icmp', label: 'ICMP' },
  { value: 'any', label: 'Any' },
]

const ACTION_COLORS: Record<string, string> = {
  accept: 'bg-success/20 text-success',
  drop: 'bg-error/20 text-error',
  reject: 'bg-warning/20 text-warning',
}

// ---- Component ----

export function FirewallBasicsPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const filterRules = useConfigBrowse(tenantId, deviceId, '/ip/firewall/filter', { enabled: active })
  const addressLists = useConfigBrowse(tenantId, deviceId, '/ip/firewall/address-list', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-firewall')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Rule dialog state
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleForm>(EMPTY_RULE)

  // Address list dialog state
  const [addrDialogOpen, setAddrDialogOpen] = useState(false)
  const [addrForm, setAddrForm] = useState<AddressListForm>(EMPTY_ADDR)

  // Address delete confirmation state
  const [confirmAddrDeleteOpen, setConfirmAddrDeleteOpen] = useState(false)
  const [deletingAddr, setDeletingAddr] = useState<Record<string, string> | null>(null)

  // Collapsed address list groups
  const [collapsedLists, setCollapsedLists] = useState<Set<string>>(new Set())

  // Filter rules by chain
  const inputRules = filterRules.entries.filter((e) => e.chain === 'input')
  const forwardRules = filterRules.entries.filter((e) => e.chain === 'forward')

  // Group address list entries by list name
  const addressListGroups: Record<string, Array<Record<string, string>>> = {}
  addressLists.entries.forEach((entry) => {
    const listName = entry.list ?? 'unknown'
    if (!addressListGroups[listName]) addressListGroups[listName] = []
    addressListGroups[listName].push(entry)
  })
  const uniqueListCount = Object.keys(addressListGroups).length

  const isLoading = filterRules.isLoading || addressLists.isLoading

  // ---- Rule dialog handlers ----

  const openAddRuleDialog = (chain: string) => {
    setEditingRuleId(null)
    setRuleForm({ ...EMPTY_RULE, chain })
    setRuleDialogOpen(true)
  }

  const openEditRuleDialog = (entry: Record<string, string>) => {
    setEditingRuleId(entry['.id'])
    setRuleForm({
      chain: entry.chain ?? 'input',
      action: entry.action ?? 'accept',
      protocol: entry.protocol || 'any',
      'dst-port': entry['dst-port'] ?? '',
      'src-address': entry['src-address'] ?? '',
      comment: entry.comment ?? '',
      disabled: entry.disabled ?? 'false',
    })
    setRuleDialogOpen(true)
  }

  const handleRuleSave = () => {
    const props: Record<string, string> = {
      chain: ruleForm.chain,
      action: ruleForm.action,
    }
    if (ruleForm.protocol && ruleForm.protocol !== 'any') props.protocol = ruleForm.protocol
    if (ruleForm['dst-port'] && (ruleForm.protocol === 'tcp' || ruleForm.protocol === 'udp')) {
      props['dst-port'] = ruleForm['dst-port']
    }
    if (ruleForm['src-address']) props['src-address'] = ruleForm['src-address']
    if (ruleForm.comment) props.comment = ruleForm.comment
    if (ruleForm.disabled === 'true') props.disabled = 'true'

    const chainLabel = ruleForm.chain === 'input' ? 'Input' : 'Forward'

    if (editingRuleId) {
      panel.addChange({
        operation: 'set',
        path: '/ip/firewall/filter',
        entryId: editingRuleId,
        properties: props,
        description: `Update ${chainLabel} rule: ${ruleForm.action} ${ruleForm.protocol === 'any' ? 'any' : ruleForm.protocol}${ruleForm['dst-port'] ? `:${ruleForm['dst-port']}` : ''}`,
      })
    } else {
      panel.addChange({
        operation: 'add',
        path: '/ip/firewall/filter',
        properties: props,
        description: `Add ${chainLabel} rule: ${ruleForm.action} ${ruleForm.protocol === 'any' ? 'any' : ruleForm.protocol}${ruleForm['dst-port'] ? `:${ruleForm['dst-port']}` : ''}`,
      })
    }

    setRuleDialogOpen(false)
    setRuleForm(EMPTY_RULE)
    setEditingRuleId(null)
  }

  const handleRuleDelete = (entry: Record<string, string>) => {
    panel.addChange({
      operation: 'remove',
      path: '/ip/firewall/filter',
      entryId: entry['.id'],
      properties: {},
      description: `Delete firewall rule: ${entry.comment || `${entry.action} ${entry.protocol || 'any'}`}`,
    })
  }

  const handleRuleToggle = (entry: Record<string, string>) => {
    const newDisabled = entry.disabled === 'true' ? 'false' : 'true'
    panel.addChange({
      operation: 'set',
      path: '/ip/firewall/filter',
      entryId: entry['.id'],
      properties: { disabled: newDisabled },
      description: `${newDisabled === 'true' ? 'Disable' : 'Enable'} firewall rule: ${entry.comment || entry['.id']}`,
    })
  }

  // ---- Address list handlers ----

  const openAddrDialog = () => {
    setAddrForm(EMPTY_ADDR)
    setAddrDialogOpen(true)
  }

  const handleAddrSave = () => {
    panel.addChange({
      operation: 'add',
      path: '/ip/firewall/address-list',
      properties: {
        list: addrForm.list,
        address: addrForm.address,
        ...(addrForm.comment ? { comment: addrForm.comment } : {}),
      },
      description: `Add address ${addrForm.address} to list "${addrForm.list}"`,
    })

    setAddrDialogOpen(false)
    setAddrForm(EMPTY_ADDR)
  }

  const handleAddrDelete = (entry: Record<string, string>) => {
    setDeletingAddr(entry)
    setConfirmAddrDeleteOpen(true)
  }

  const confirmAddrDelete = () => {
    if (!deletingAddr) return
    panel.addChange({
      operation: 'remove',
      path: '/ip/firewall/address-list',
      entryId: deletingAddr['.id'],
      properties: {},
      description: `Remove ${deletingAddr.address} from list "${deletingAddr.list}"`,
    })
    setConfirmAddrDeleteOpen(false)
    setDeletingAddr(null)
  }

  const toggleListCollapse = (listName: string) => {
    setCollapsedLists((prev) => {
      const next = new Set(prev)
      if (next.has(listName)) next.delete(listName)
      else next.add(listName)
      return next
    })
  }

  // ---- Loading ----

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading firewall configuration...
      </div>
    )
  }

  // ---- Render ----

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'Input Rules', value: String(inputRules.length) },
          { label: 'Forward Rules', value: String(forwardRules.length) },
          { label: 'Address Lists', value: String(uniqueListCount) },
        ]}
        isLoading={isLoading}
      />

      {/* Input Chain */}
      <SimpleFormSection icon={Shield} title="Incoming Traffic" description="Rules that control traffic destined to this router itself">
        <RulesTable
          rules={inputRules}
          onEdit={openEditRuleDialog}
          onDelete={handleRuleDelete}
          onToggle={handleRuleToggle}
        />
        <Button size="sm" variant="outline" onClick={() => openAddRuleDialog('input')} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Input Rule
        </Button>
      </SimpleFormSection>

      {/* Forward Chain */}
      <SimpleFormSection icon={Network} title="Forwarded Traffic" description="Rules that control traffic passing through this router">
        <RulesTable
          rules={forwardRules}
          onEdit={openEditRuleDialog}
          onDelete={handleRuleDelete}
          onToggle={handleRuleToggle}
        />
        <Button size="sm" variant="outline" onClick={() => openAddRuleDialog('forward')} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Forward Rule
        </Button>
      </SimpleFormSection>

      {/* Address Lists */}
      <SimpleFormSection icon={List} title="Address Lists" description="Named groups of IP addresses used by firewall rules">
        {uniqueListCount === 0 ? (
          <p className="text-xs text-text-muted">No address lists configured</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(addressListGroups).map(([listName, entries]) => {
              const isCollapsed = collapsedLists.has(listName)
              return (
                <div key={listName} className="rounded-lg border border-border/50 overflow-hidden">
                  <button
                    className="flex items-center gap-2 w-full px-3 py-2 bg-elevated/20 hover:bg-elevated/40 transition-colors text-left"
                    onClick={() => toggleListCollapse(listName)}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
                    )}
                    <span className="text-xs font-medium text-text-primary">{listName}</span>
                    <span className="text-xs bg-elevated px-1.5 py-0.5 rounded text-text-muted">
                      {entries.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="px-3 py-2 flex flex-wrap gap-1.5">
                      {entries.map((entry) => (
                        <span
                          key={entry['.id']}
                          className="inline-flex items-center gap-1 rounded bg-elevated/50 px-2 py-0.5 text-xs font-mono text-text-secondary"
                        >
                          {entry.address}
                          <button
                            className="text-text-muted hover:text-error transition-colors"
                            onClick={() => handleAddrDelete(entry)}
                            title="Remove from list"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <Button size="sm" variant="outline" onClick={openAddrDialog} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add to List
        </Button>
      </SimpleFormSection>

      <SimpleApplyBar
        pendingCount={panel.pendingChanges.length}
        isApplying={panel.isApplying}
        onReviewClick={() => setPreviewOpen(true)}
      />

      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }}
        isApplying={panel.isApplying}
      />

      {/* Add/Edit Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingRuleId ? 'Edit Firewall Rule' : 'Add Firewall Rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Chain <span className="text-error">*</span></Label>
              <Select value={ruleForm.chain} onValueChange={(v) => setRuleForm((f) => ({ ...f, chain: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="input">Input</SelectItem>
                  <SelectItem value="forward">Forward</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Action <span className="text-error">*</span></Label>
              <Select value={ruleForm.action} onValueChange={(v) => setRuleForm((f) => ({ ...f, action: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Protocol <span className="text-error">*</span></Label>
              <Select value={ruleForm.protocol} onValueChange={(v) => setRuleForm((f) => ({ ...f, protocol: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(ruleForm.protocol === 'tcp' || ruleForm.protocol === 'udp') && (
              <div className="space-y-1">
                <Label className="text-sm">Destination Port</Label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={ruleForm['dst-port']}
                  onChange={(e) => setRuleForm((f) => ({ ...f, 'dst-port': e.target.value }))}
                  placeholder="e.g., 22, 80, 443"
                  className="h-8 text-sm"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-sm">Source Address</Label>
              <Input
                value={ruleForm['src-address']}
                onChange={(e) => setRuleForm((f) => ({ ...f, 'src-address': e.target.value }))}
                placeholder="e.g., 192.168.88.0/24"
                className="h-8 text-sm"
              />
              <p className="text-xs text-text-muted">Leave blank to match any source</p>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Comment</Label>
              <Input
                value={ruleForm.comment}
                onChange={(e) => setRuleForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="e.g., Allow SSH from LAN"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRuleDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleRuleSave}>
              {editingRuleId ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Address List Entry Dialog */}
      <Dialog open={addrDialogOpen} onOpenChange={setAddrDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Address List</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">List Name <span className="text-error">*</span></Label>
              <Input
                value={addrForm.list}
                onChange={(e) => setAddrForm((f) => ({ ...f, list: e.target.value }))}
                placeholder="e.g., blocklist, trusted"
                className="h-8 text-sm"
                list="existing-lists"
              />
              {uniqueListCount > 0 && (
                <datalist id="existing-lists">
                  {Object.keys(addressListGroups).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Address <span className="text-error">*</span></Label>
              <Input
                value={addrForm.address}
                onChange={(e) => setAddrForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="192.168.88.100 or 10.0.0.0/8"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Comment</Label>
              <Input
                value={addrForm.comment}
                onChange={(e) => setAddrForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="Optional description"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddrDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAddrSave}
              disabled={!addrForm.list || !addrForm.address}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Address Delete Confirmation Dialog */}
      <Dialog open={confirmAddrDeleteOpen} onOpenChange={(o) => { if (!o) { setConfirmAddrDeleteOpen(false); setDeletingAddr(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Address?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            This will stage the removal of this address from the firewall list. The change takes effect when you apply.
          </p>
          {deletingAddr && (
            <div className="space-y-1.5 bg-elevated/50 rounded-lg p-3">
              <div className="flex gap-2 text-xs">
                <span className="text-text-muted w-14 shrink-0">List</span>
                <span className="font-medium text-text-primary">{deletingAddr.list}</span>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="text-text-muted w-14 shrink-0">Address</span>
                <span className="font-mono text-text-primary">{deletingAddr.address}</span>
              </div>
              {deletingAddr.comment && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-14 shrink-0">Comment</span>
                  <span className="text-text-secondary italic">{deletingAddr.comment}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setConfirmAddrDeleteOpen(false); setDeletingAddr(null) }}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={confirmAddrDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---- Rules Table sub-component ----

function RulesTable({
  rules,
  onEdit,
  onDelete,
  onToggle,
}: {
  rules: Array<Record<string, string>>
  onEdit: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
  onToggle: (entry: Record<string, string>) => void
}) {
  if (rules.length === 0) {
    return <p className="text-xs text-text-muted">No rules in this chain</p>
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-elevated/30">
            <th className="text-left px-3 py-2 font-medium text-text-muted w-8">#</th>
            <th className="text-left px-3 py-2 font-medium text-text-muted">Action</th>
            <th className="text-left px-3 py-2 font-medium text-text-muted">Protocol</th>
            <th className="text-left px-3 py-2 font-medium text-text-muted">Port</th>
            <th className="text-left px-3 py-2 font-medium text-text-muted">Source</th>
            <th className="text-left px-3 py-2 font-medium text-text-muted">Comment</th>
            <th className="text-left px-3 py-2 font-medium text-text-muted">Status</th>
            <th className="text-right px-3 py-2 font-medium text-text-muted">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((entry, idx) => (
            <tr
              key={entry['.id']}
              className={cn(
                'border-b border-border/30 last:border-0',
                entry.disabled === 'true' && 'opacity-50',
              )}
            >
              <td className="px-3 py-1.5 text-text-muted">{idx + 1}</td>
              <td className="px-3 py-1.5">
                <span className={cn(
                  'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
                  ACTION_COLORS[entry.action] ?? 'bg-elevated text-text-muted',
                )}>
                  {entry.action}
                </span>
              </td>
              <td className="px-3 py-1.5 text-text-secondary uppercase">{entry.protocol || 'any'}</td>
              <td className="px-3 py-1.5 font-mono text-text-secondary">{entry['dst-port'] || 'any'}</td>
              <td className="px-3 py-1.5 font-mono text-text-secondary">{entry['src-address'] || 'any'}</td>
              <td className="px-3 py-1.5 text-text-muted truncate max-w-[120px]">{entry.comment || '\u2014'}</td>
              <td className="px-3 py-1.5">
                {entry.disabled === 'true' ? (
                  <span className="text-text-muted">Off</span>
                ) : (
                  <span className="text-success">On</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => onToggle(entry)}
                    title={entry.disabled === 'true' ? 'Enable' : 'Disable'}
                  >
                    {entry.disabled === 'true' ? (
                      <Power className="h-3 w-3" />
                    ) : (
                      <PowerOff className="h-3 w-3" />
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onEdit(entry)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-error" onClick={() => onDelete(entry)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
