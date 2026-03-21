/**
 * IpsecPanel -- IPsec configuration panel.
 *
 * Sub-tabs:
 * 1. Peers -- IPsec peer configuration
 * 2. Policies -- IPsec policies with src/dst address
 * 3. Proposals -- Encryption/auth algorithm proposals
 * 4. Active SAs -- Installed security associations (read-only)
 *
 * Safe apply mode by default.
 */

import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Shield, Lock, Key, Activity } from 'lucide-react'
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
// Sub-tab types
// ---------------------------------------------------------------------------

type SubTab = 'peers' | 'policies' | 'proposals' | 'sas'

const SUB_TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: 'peers', label: 'Peers', icon: <Shield className="h-3.5 w-3.5" /> },
  { key: 'policies', label: 'Policies', icon: <Lock className="h-3.5 w-3.5" /> },
  { key: 'proposals', label: 'Proposals', icon: <Key className="h-3.5 w-3.5" /> },
  { key: 'sas', label: 'Active SAs', icon: <Activity className="h-3.5 w-3.5" /> },
]

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

interface PeerEntry { '.id': string; address: string; 'auth-method': string; secret: string; 'exchange-mode': string; disabled: string; [key: string]: string }
interface PolicyEntry { '.id': string; 'src-address': string; 'dst-address': string; tunnel: string; action: string; level: string; proposal: string; disabled: string; [key: string]: string }
interface ProposalEntry { '.id': string; name: string; 'auth-algorithms': string; 'enc-algorithms': string; 'pfs-group': string; [key: string]: string }
interface SaEntry { '.id': string; 'src-address': string; 'dst-address': string; state: string; 'auth-algorithm': string; 'enc-algorithm': string; [key: string]: string }

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// IpsecPanel
// ---------------------------------------------------------------------------

export function IpsecPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('peers')

  const peers = useConfigBrowse(tenantId, deviceId, '/ip/ipsec/peer', { enabled: active })
  const policies = useConfigBrowse(tenantId, deviceId, '/ip/ipsec/policy', { enabled: active })
  const proposals = useConfigBrowse(tenantId, deviceId, '/ip/ipsec/proposal', { enabled: active })
  const sas = useConfigBrowse(tenantId, deviceId, '/ip/ipsec/installed-sa', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'ipsec')
  const [previewOpen, setPreviewOpen] = useState(false)

  const isLoading = peers.isLoading || policies.isLoading || proposals.isLoading

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading IPsec configuration...</div>
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
        {SUB_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === tab.key ? 'bg-panel text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-panel/50')}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'peers' && <PeersTab entries={peers.entries as PeerEntry[]} panel={panel} />}
      {activeTab === 'policies' && <PoliciesTab entries={policies.entries as PolicyEntry[]} panel={panel} />}
      {activeTab === 'proposals' && <ProposalsTab entries={proposals.entries as ProposalEntry[]} panel={panel} />}
      {activeTab === 'sas' && <SasTab entries={sas.entries as SaEntry[]} />}

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peers Tab
// ---------------------------------------------------------------------------

function PeersTab({ entries, panel }: { entries: PeerEntry[]; panel: PanelHook }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PeerEntry | null>(null)
  const [form, setForm] = useState({ address: '', 'auth-method': 'pre-shared-key', secret: '', 'exchange-mode': 'main' })

  const handleAdd = useCallback(() => { setEditing(null); setForm({ address: '', 'auth-method': 'pre-shared-key', secret: '', 'exchange-mode': 'main' }); setDialogOpen(true) }, [])
  const handleEdit = useCallback((e: PeerEntry) => { setEditing(e); setForm({ address: e.address || '', 'auth-method': e['auth-method'] || 'pre-shared-key', secret: '', 'exchange-mode': e['exchange-mode'] || 'main' }); setDialogOpen(true) }, [])
  const handleDelete = useCallback((e: PeerEntry) => { panel.addChange({ operation: 'remove', path: '/ip/ipsec/peer', entryId: e['.id'], properties: {}, description: `Remove IPsec peer ${e.address}` }) }, [panel])
  const handleSave = useCallback(() => {
    if (!form.address) return
    const props: Record<string, string> = { address: form.address, 'auth-method': form['auth-method'], 'exchange-mode': form['exchange-mode'] }
    if (form.secret) props.secret = form.secret
    if (editing) panel.addChange({ operation: 'set', path: '/ip/ipsec/peer', entryId: editing['.id'], properties: props, description: `Edit IPsec peer ${form.address}` })
    else panel.addChange({ operation: 'add', path: '/ip/ipsec/peer', properties: props, description: `Add IPsec peer ${form.address}` })
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <TableWrapper title="IPsec Peers" count={entries.length} onAdd={handleAdd}>
        <thead><tr className="border-b border-border/50 text-text-secondary text-xs">
          <th className="text-left px-4 py-2 font-medium">Address</th><th className="text-left px-4 py-2 font-medium">Auth Method</th>
          <th className="text-left px-4 py-2 font-medium">Exchange Mode</th><th className="text-left px-4 py-2 font-medium">Status</th><th className="text-right px-4 py-2 font-medium">Actions</th>
        </tr></thead><tbody>
          {entries.map((e) => <tr key={e['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
            <td className="px-4 py-2 font-mono text-text-primary">{e.address || '—'}</td>
            <td className="px-4 py-2 text-text-secondary">{e['auth-method'] || '—'}</td>
            <td className="px-4 py-2 text-text-secondary">{e['exchange-mode'] || '—'}</td>
            <td className="px-4 py-2">{e.disabled === 'true' ? <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">disabled</span> : <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">active</span>}</td>
            <td className="px-4 py-2"><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(e)}><Trash2 className="h-3.5 w-3.5" /></Button></div></td>
          </tr>)}
        </tbody>
      </TableWrapper>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit Peer' : 'Add Peer'}</DialogTitle><DialogDescription>IPsec peer configuration.</DialogDescription></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Address</Label><Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="0.0.0.0/0" className="h-8 text-sm font-mono" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Auth Method</Label>
              <select value={form['auth-method']} onChange={(e) => setForm((f) => ({ ...f, 'auth-method': e.target.value }))} className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary">
                <option value="pre-shared-key">Pre-Shared Key</option><option value="rsa-key">RSA Key</option><option value="rsa-signature">RSA Signature</option>
              </select></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Exchange Mode</Label>
              <select value={form['exchange-mode']} onChange={(e) => setForm((f) => ({ ...f, 'exchange-mode': e.target.value }))} className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary">
                <option value="main">Main</option><option value="aggressive">Aggressive</option><option value="ike2">IKEv2</option>
              </select></div>
          </div>
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Secret {editing && '(blank = keep)'}</Label><Input type="password" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} className="h-8 text-sm" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Peer'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Policies Tab
// ---------------------------------------------------------------------------

function PoliciesTab({ entries, panel }: { entries: PolicyEntry[]; panel: PanelHook }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PolicyEntry | null>(null)
  const [form, setForm] = useState({ 'src-address': '', 'dst-address': '', tunnel: 'yes', action: 'encrypt', level: 'require', proposal: 'default' })

  const handleAdd = useCallback(() => { setEditing(null); setForm({ 'src-address': '', 'dst-address': '', tunnel: 'yes', action: 'encrypt', level: 'require', proposal: 'default' }); setDialogOpen(true) }, [])
  const handleEdit = useCallback((e: PolicyEntry) => { setEditing(e); setForm({ 'src-address': e['src-address'] || '', 'dst-address': e['dst-address'] || '', tunnel: e.tunnel || 'yes', action: e.action || 'encrypt', level: e.level || 'require', proposal: e.proposal || 'default' }); setDialogOpen(true) }, [])
  const handleDelete = useCallback((e: PolicyEntry) => { panel.addChange({ operation: 'remove', path: '/ip/ipsec/policy', entryId: e['.id'], properties: {}, description: `Remove IPsec policy ${e['src-address']} → ${e['dst-address']}` }) }, [panel])
  const handleSave = useCallback(() => {
    const props: Record<string, string> = { 'src-address': form['src-address'], 'dst-address': form['dst-address'], tunnel: form.tunnel, action: form.action, level: form.level, proposal: form.proposal }
    if (editing) panel.addChange({ operation: 'set', path: '/ip/ipsec/policy', entryId: editing['.id'], properties: props, description: `Edit IPsec policy` })
    else panel.addChange({ operation: 'add', path: '/ip/ipsec/policy', properties: props, description: `Add IPsec policy ${form['src-address']} → ${form['dst-address']}` })
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <TableWrapper title="IPsec Policies" count={entries.length} onAdd={handleAdd}>
        <thead><tr className="border-b border-border/50 text-text-secondary text-xs">
          <th className="text-left px-4 py-2 font-medium">Src Address</th><th className="text-left px-4 py-2 font-medium">Dst Address</th>
          <th className="text-left px-4 py-2 font-medium">Tunnel</th><th className="text-left px-4 py-2 font-medium">Action</th>
          <th className="text-left px-4 py-2 font-medium">Proposal</th><th className="text-right px-4 py-2 font-medium">Actions</th>
        </tr></thead><tbody>
          {entries.map((e) => <tr key={e['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
            <td className="px-4 py-2 font-mono text-text-primary text-xs">{e['src-address'] || '—'}</td>
            <td className="px-4 py-2 font-mono text-text-primary text-xs">{e['dst-address'] || '—'}</td>
            <td className="px-4 py-2 text-text-secondary">{e.tunnel}</td>
            <td className="px-4 py-2"><span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-info/10 text-info border-info/40">{e.action}</span></td>
            <td className="px-4 py-2 text-text-secondary">{e.proposal || '—'}</td>
            <td className="px-4 py-2"><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(e)}><Trash2 className="h-3.5 w-3.5" /></Button></div></td>
          </tr>)}
        </tbody>
      </TableWrapper>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit Policy' : 'Add Policy'}</DialogTitle><DialogDescription>IPsec policy settings.</DialogDescription></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Src Address</Label><Input value={form['src-address']} onChange={(e) => setForm((f) => ({ ...f, 'src-address': e.target.value }))} placeholder="192.168.1.0/24" className="h-8 text-sm font-mono" /></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Dst Address</Label><Input value={form['dst-address']} onChange={(e) => setForm((f) => ({ ...f, 'dst-address': e.target.value }))} placeholder="10.0.0.0/24" className="h-8 text-sm font-mono" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Tunnel</Label><select value={form.tunnel} onChange={(e) => setForm((f) => ({ ...f, tunnel: e.target.value }))} className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary"><option value="yes">Yes</option><option value="no">No</option></select></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Action</Label><select value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))} className="h-8 w-full rounded-md border border-border bg-panel px-3 text-sm text-text-primary"><option value="encrypt">Encrypt</option><option value="none">None</option></select></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Proposal</Label><Input value={form.proposal} onChange={(e) => setForm((f) => ({ ...f, proposal: e.target.value }))} className="h-8 text-sm" /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Policy'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Proposals Tab
// ---------------------------------------------------------------------------

function ProposalsTab({ entries, panel }: { entries: ProposalEntry[]; panel: PanelHook }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProposalEntry | null>(null)
  const [form, setForm] = useState({ name: '', 'auth-algorithms': 'sha256', 'enc-algorithms': 'aes-256-cbc', 'pfs-group': 'modp2048' })

  const handleAdd = useCallback(() => { setEditing(null); setForm({ name: '', 'auth-algorithms': 'sha256', 'enc-algorithms': 'aes-256-cbc', 'pfs-group': 'modp2048' }); setDialogOpen(true) }, [])
  const handleEdit = useCallback((e: ProposalEntry) => { setEditing(e); setForm({ name: e.name || '', 'auth-algorithms': e['auth-algorithms'] || '', 'enc-algorithms': e['enc-algorithms'] || '', 'pfs-group': e['pfs-group'] || '' }); setDialogOpen(true) }, [])
  const handleDelete = useCallback((e: ProposalEntry) => { panel.addChange({ operation: 'remove', path: '/ip/ipsec/proposal', entryId: e['.id'], properties: {}, description: `Remove IPsec proposal "${e.name}"` }) }, [panel])
  const handleSave = useCallback(() => {
    if (!form.name) return
    const props: Record<string, string> = { name: form.name, 'auth-algorithms': form['auth-algorithms'], 'enc-algorithms': form['enc-algorithms'], 'pfs-group': form['pfs-group'] }
    if (editing) panel.addChange({ operation: 'set', path: '/ip/ipsec/proposal', entryId: editing['.id'], properties: props, description: `Edit IPsec proposal "${form.name}"` })
    else panel.addChange({ operation: 'add', path: '/ip/ipsec/proposal', properties: props, description: `Add IPsec proposal "${form.name}"` })
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <TableWrapper title="IPsec Proposals" count={entries.length} onAdd={handleAdd}>
        <thead><tr className="border-b border-border/50 text-text-secondary text-xs">
          <th className="text-left px-4 py-2 font-medium">Name</th><th className="text-left px-4 py-2 font-medium">Auth</th>
          <th className="text-left px-4 py-2 font-medium">Encryption</th><th className="text-left px-4 py-2 font-medium">PFS Group</th><th className="text-right px-4 py-2 font-medium">Actions</th>
        </tr></thead><tbody>
          {entries.map((e) => <tr key={e['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
            <td className="px-4 py-2 text-text-primary font-medium">{e.name}</td>
            <td className="px-4 py-2 text-text-secondary text-xs">{e['auth-algorithms'] || '—'}</td>
            <td className="px-4 py-2 text-text-secondary text-xs">{e['enc-algorithms'] || '—'}</td>
            <td className="px-4 py-2 text-text-secondary">{e['pfs-group'] || '—'}</td>
            <td className="px-4 py-2"><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(e)}><Trash2 className="h-3.5 w-3.5" /></Button></div></td>
          </tr>)}
        </tbody>
      </TableWrapper>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit Proposal' : 'Add Proposal'}</DialogTitle><DialogDescription>IPsec proposal settings.</DialogDescription></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" /></div>
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Auth Algorithms</Label><Input value={form['auth-algorithms']} onChange={(e) => setForm((f) => ({ ...f, 'auth-algorithms': e.target.value }))} placeholder="sha256" className="h-8 text-sm" /></div>
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Enc Algorithms</Label><Input value={form['enc-algorithms']} onChange={(e) => setForm((f) => ({ ...f, 'enc-algorithms': e.target.value }))} placeholder="aes-256-cbc" className="h-8 text-sm" /></div>
          <div className="space-y-1"><Label className="text-xs text-text-secondary">PFS Group</Label><Input value={form['pfs-group']} onChange={(e) => setForm((f) => ({ ...f, 'pfs-group': e.target.value }))} placeholder="modp2048" className="h-8 text-sm" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Proposal'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Active SAs Tab (read-only)
// ---------------------------------------------------------------------------

function SasTab({ entries }: { entries: SaEntry[] }) {
  return (
    <div className="rounded-lg border border-border bg-panel overflow-hidden">
      <div className="px-4 py-2 border-b border-border/50"><span className="text-sm font-medium text-text-secondary">Installed SAs ({entries.length})</span></div>
      {entries.length === 0 ? <div className="px-4 py-8 text-center text-sm text-text-muted">No active security associations.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-text-secondary text-xs">
          <th className="text-left px-4 py-2 font-medium">Src Address</th><th className="text-left px-4 py-2 font-medium">Dst Address</th>
          <th className="text-left px-4 py-2 font-medium">State</th><th className="text-left px-4 py-2 font-medium">Auth</th><th className="text-left px-4 py-2 font-medium">Encryption</th>
        </tr></thead><tbody>
          {entries.map((e) => <tr key={e['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
            <td className="px-4 py-2 font-mono text-text-primary text-xs">{e['src-address']}</td>
            <td className="px-4 py-2 font-mono text-text-primary text-xs">{e['dst-address']}</td>
            <td className="px-4 py-2"><span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">{e.state || 'mature'}</span></td>
            <td className="px-4 py-2 text-text-secondary text-xs">{e['auth-algorithm'] || '—'}</td>
            <td className="px-4 py-2 text-text-secondary text-xs">{e['enc-algorithm'] || '—'}</td>
          </tr>)}
        </tbody></table></div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table Wrapper
// ---------------------------------------------------------------------------

function TableWrapper({ title, count, onAdd, children }: { title: string; count: number; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <span className="text-sm font-medium text-text-secondary">{title} ({count})</span>
        <Button size="sm" variant="outline" className="gap-1" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add</Button>
      </div>
      {count === 0 ? <div className="px-4 py-8 text-center text-sm text-text-muted">No entries found.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>
      )}
    </div>
  )
}
