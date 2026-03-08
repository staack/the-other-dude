/**
 * PppPanel -- PPP profiles, secrets, and active connections management.
 *
 * Sub-tabs:
 * 1. Profiles -- PPP profiles with rate-limit, bridge assignment
 * 2. Secrets -- PPP user secrets with service/profile/caller-id
 * 3. Active -- Active PPP connections (read-only with disconnect)
 *
 * Safe apply mode by default.
 */

import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Users, Key, Activity, XCircle } from 'lucide-react'
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

type SubTab = 'profiles' | 'secrets' | 'active'

const SUB_TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: 'profiles', label: 'Profiles', icon: <Users className="h-3.5 w-3.5" /> },
  { key: 'secrets', label: 'Secrets', icon: <Key className="h-3.5 w-3.5" /> },
  { key: 'active', label: 'Active', icon: <Activity className="h-3.5 w-3.5" /> },
]

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

interface ProfileEntry { '.id': string; name: string; 'local-address': string; 'remote-address': string; 'dns-server': string; 'rate-limit': string; bridge: string; [key: string]: string }
interface SecretEntry { '.id': string; name: string; password: string; service: string; profile: string; 'caller-id': string; 'remote-address': string; disabled: string; [key: string]: string }
interface ActiveEntry { '.id': string; name: string; service: string; 'caller-id': string; address: string; uptime: string; [key: string]: string }

// ---------------------------------------------------------------------------
// Form types
// ---------------------------------------------------------------------------

interface ProfileForm { name: string; 'local-address': string; 'remote-address': string; 'dns-server': string; 'rate-limit': string; bridge: string }
interface SecretForm { name: string; password: string; service: string; profile: string; 'caller-id': string; 'remote-address': string }

const EMPTY_PROFILE: ProfileForm = { name: '', 'local-address': '', 'remote-address': '', 'dns-server': '', 'rate-limit': '', bridge: '' }
const EMPTY_SECRET: SecretForm = { name: '', password: '', service: 'any', profile: 'default', 'caller-id': '', 'remote-address': '' }

const PPP_SERVICES = ['any', 'async', 'l2tp', 'ovpn', 'pppoe', 'pptp', 'sstp']

type PanelHook = ReturnType<typeof useConfigPanel>

// ---------------------------------------------------------------------------
// PppPanel
// ---------------------------------------------------------------------------

export function PppPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('profiles')

  const profiles = useConfigBrowse(tenantId, deviceId, '/ppp/profile', { enabled: active })
  const secrets = useConfigBrowse(tenantId, deviceId, '/ppp/secret', { enabled: active })
  const activeConns = useConfigBrowse(tenantId, deviceId, '/ppp/active', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'ppp')
  const [previewOpen, setPreviewOpen] = useState(false)

  const isLoading = profiles.isLoading || secrets.isLoading || activeConns.isLoading

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-text-secondary text-sm">Loading PPP configuration...</div>
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
              activeTab === tab.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface/50')}>
            {tab.icon}{tab.label}
            {tab.key === 'active' && activeConns.entries.length > 0 && (
              <span className="text-xs bg-accent/20 text-accent px-1 rounded">{activeConns.entries.length}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'profiles' && <ProfilesTab entries={profiles.entries as ProfileEntry[]} panel={panel} />}
      {activeTab === 'secrets' && <SecretsTab entries={secrets.entries as SecretEntry[]} panel={panel} profileNames={(profiles.entries as ProfileEntry[]).map((p) => p.name).filter(Boolean)} />}
      {activeTab === 'active' && <ActiveTab entries={activeConns.entries as ActiveEntry[]} tenantId={tenantId} deviceId={deviceId} refetch={activeConns.refetch} />}

      <ChangePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} changes={panel.pendingChanges} applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }} isApplying={panel.isApplying} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profiles Tab
// ---------------------------------------------------------------------------

function ProfilesTab({ entries, panel }: { entries: ProfileEntry[]; panel: PanelHook }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProfileEntry | null>(null)
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE)

  const handleAdd = useCallback(() => { setEditing(null); setForm(EMPTY_PROFILE); setDialogOpen(true) }, [])
  const handleEdit = useCallback((e: ProfileEntry) => {
    setEditing(e); setForm({ name: e.name || '', 'local-address': e['local-address'] || '', 'remote-address': e['remote-address'] || '', 'dns-server': e['dns-server'] || '', 'rate-limit': e['rate-limit'] || '', bridge: e.bridge || '' }); setDialogOpen(true)
  }, [])
  const handleDelete = useCallback((e: ProfileEntry) => { panel.addChange({ operation: 'remove', path: '/ppp/profile', entryId: e['.id'], properties: {}, description: `Remove PPP profile "${e.name}"` }) }, [panel])
  const handleSave = useCallback(() => {
    if (!form.name) return
    const props: Record<string, string> = { name: form.name }
    if (form['local-address']) props['local-address'] = form['local-address']
    if (form['remote-address']) props['remote-address'] = form['remote-address']
    if (form['dns-server']) props['dns-server'] = form['dns-server']
    if (form['rate-limit']) props['rate-limit'] = form['rate-limit']
    if (form.bridge) props.bridge = form.bridge
    if (editing) panel.addChange({ operation: 'set', path: '/ppp/profile', entryId: editing['.id'], properties: props, description: `Edit PPP profile "${form.name}"` })
    else panel.addChange({ operation: 'add', path: '/ppp/profile', properties: props, description: `Add PPP profile "${form.name}"` })
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">PPP Profiles ({entries.length})</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}><Plus className="h-3.5 w-3.5" />Add Profile</Button>
        </div>
        {entries.length === 0 ? <div className="px-4 py-8 text-center text-sm text-text-muted">No profiles.</div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-text-secondary text-xs">
            <th className="text-left px-4 py-2 font-medium">Name</th><th className="text-left px-4 py-2 font-medium">Local Addr</th><th className="text-left px-4 py-2 font-medium">Remote Addr</th>
            <th className="text-left px-4 py-2 font-medium">DNS</th><th className="text-left px-4 py-2 font-medium">Rate Limit</th><th className="text-left px-4 py-2 font-medium">Bridge</th>
            <th className="text-right px-4 py-2 font-medium">Actions</th>
          </tr></thead><tbody>
            {entries.map((e) => <tr key={e['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
              <td className="px-4 py-2 text-text-primary font-medium">{e.name}</td>
              <td className="px-4 py-2 font-mono text-text-secondary text-xs">{e['local-address'] || '—'}</td>
              <td className="px-4 py-2 font-mono text-text-secondary text-xs">{e['remote-address'] || '—'}</td>
              <td className="px-4 py-2 text-text-secondary text-xs">{e['dns-server'] || '—'}</td>
              <td className="px-4 py-2 text-text-secondary text-xs">{e['rate-limit'] || '—'}</td>
              <td className="px-4 py-2 text-text-secondary text-xs">{e.bridge || '—'}</td>
              <td className="px-4 py-2"><div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(e)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div></td>
            </tr>)}
          </tbody></table></div>
        )}
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit Profile' : 'Add Profile'}</DialogTitle><DialogDescription>PPP profile settings.</DialogDescription></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Local Address</Label><Input value={form['local-address']} onChange={(e) => setForm((f) => ({ ...f, 'local-address': e.target.value }))} placeholder="10.0.0.1" className="h-8 text-sm font-mono" /></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Remote Address</Label><Input value={form['remote-address']} onChange={(e) => setForm((f) => ({ ...f, 'remote-address': e.target.value }))} placeholder="pool-name" className="h-8 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">DNS Server</Label><Input value={form['dns-server']} onChange={(e) => setForm((f) => ({ ...f, 'dns-server': e.target.value }))} placeholder="8.8.8.8" className="h-8 text-sm font-mono" /></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Rate Limit</Label><Input value={form['rate-limit']} onChange={(e) => setForm((f) => ({ ...f, 'rate-limit': e.target.value }))} placeholder="10M/10M" className="h-8 text-sm" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs text-text-secondary">Bridge</Label><Input value={form.bridge} onChange={(e) => setForm((f) => ({ ...f, bridge: e.target.value }))} placeholder="none" className="h-8 text-sm" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Profile'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Secrets Tab
// ---------------------------------------------------------------------------

function SecretsTab({ entries, panel, profileNames }: { entries: SecretEntry[]; panel: PanelHook; profileNames: string[] }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SecretEntry | null>(null)
  const [form, setForm] = useState<SecretForm>(EMPTY_SECRET)

  const handleAdd = useCallback(() => { setEditing(null); setForm(EMPTY_SECRET); setDialogOpen(true) }, [])
  const handleEdit = useCallback((e: SecretEntry) => {
    setEditing(e); setForm({ name: e.name || '', password: '', service: e.service || 'any', profile: e.profile || 'default', 'caller-id': e['caller-id'] || '', 'remote-address': e['remote-address'] || '' }); setDialogOpen(true)
  }, [])
  const handleDelete = useCallback((e: SecretEntry) => { panel.addChange({ operation: 'remove', path: '/ppp/secret', entryId: e['.id'], properties: {}, description: `Remove PPP secret "${e.name}"` }) }, [panel])
  const handleSave = useCallback(() => {
    if (!form.name) return
    const props: Record<string, string> = { name: form.name, service: form.service, profile: form.profile }
    if (form.password) props.password = form.password
    if (form['caller-id']) props['caller-id'] = form['caller-id']
    if (form['remote-address']) props['remote-address'] = form['remote-address']
    if (editing) panel.addChange({ operation: 'set', path: '/ppp/secret', entryId: editing['.id'], properties: props, description: `Edit PPP secret "${form.name}"` })
    else panel.addChange({ operation: 'add', path: '/ppp/secret', properties: props, description: `Add PPP secret "${form.name}"` })
    setDialogOpen(false)
  }, [form, editing, panel])

  return (
    <>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-secondary">PPP Secrets ({entries.length})</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAdd}><Plus className="h-3.5 w-3.5" />Add Secret</Button>
        </div>
        {entries.length === 0 ? <div className="px-4 py-8 text-center text-sm text-text-muted">No secrets.</div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-text-secondary text-xs">
            <th className="text-left px-4 py-2 font-medium">Name</th><th className="text-left px-4 py-2 font-medium">Service</th><th className="text-left px-4 py-2 font-medium">Profile</th>
            <th className="text-left px-4 py-2 font-medium">Caller ID</th><th className="text-left px-4 py-2 font-medium">Status</th><th className="text-right px-4 py-2 font-medium">Actions</th>
          </tr></thead><tbody>
            {entries.map((e) => <tr key={e['.id']} className={cn('border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors', e.disabled === 'true' && 'opacity-50')}>
              <td className="px-4 py-2 text-text-primary font-medium">{e.name}</td>
              <td className="px-4 py-2 text-text-secondary">{e.service || 'any'}</td>
              <td className="px-4 py-2 text-text-secondary">{e.profile || '—'}</td>
              <td className="px-4 py-2 font-mono text-text-muted text-xs">{e['caller-id'] || '—'}</td>
              <td className="px-4 py-2">{e.disabled === 'true' ? <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40">disabled</span> : <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">active</span>}</td>
              <td className="px-4 py-2"><div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-error hover:text-error" onClick={() => handleDelete(e)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div></td>
            </tr>)}
          </tbody></table></div>
        )}
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit Secret' : 'Add Secret'}</DialogTitle><DialogDescription>PPP user credentials and settings.</DialogDescription></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Username</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Password</Label><Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={editing ? 'unchanged' : 'required'} className="h-8 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Service</Label>
              <select value={form.service} onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))} className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary">
                {PPP_SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Profile</Label><Input value={form.profile} onChange={(e) => setForm((f) => ({ ...f, profile: e.target.value }))} placeholder="default" className="h-8 text-sm" list="profile-names" />
              <datalist id="profile-names">{profileNames.map((n) => <option key={n} value={n} />)}</datalist></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Caller ID</Label><Input value={form['caller-id']} onChange={(e) => setForm((f) => ({ ...f, 'caller-id': e.target.value }))} className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs text-text-secondary">Remote Address</Label><Input value={form['remote-address']} onChange={(e) => setForm((f) => ({ ...f, 'remote-address': e.target.value }))} placeholder="from pool" className="h-8 text-sm font-mono" /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Stage Edit' : 'Stage Secret'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Active Connections Tab
// ---------------------------------------------------------------------------

function ActiveTab({ entries, tenantId, deviceId, refetch }: { entries: ActiveEntry[]; tenantId: string; deviceId: string; refetch: () => void }) {
  const disconnectMutation = useMutation({
    mutationFn: (entryId: string) => configEditorApi.removeEntry(tenantId, deviceId, '/ppp/active', entryId),
    onSuccess: () => { toast.success('Connection disconnected'); refetch() },
    onError: (err: Error) => { toast.error('Failed to disconnect', { description: err.message }) },
  })

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-4 py-2 border-b border-border/50">
        <span className="text-sm font-medium text-text-secondary">Active Connections ({entries.length})</span>
      </div>
      {entries.length === 0 ? <div className="px-4 py-8 text-center text-sm text-text-muted">No active PPP connections.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-text-secondary text-xs">
          <th className="text-left px-4 py-2 font-medium">Name</th><th className="text-left px-4 py-2 font-medium">Service</th>
          <th className="text-left px-4 py-2 font-medium">Caller ID</th><th className="text-left px-4 py-2 font-medium">Address</th>
          <th className="text-left px-4 py-2 font-medium">Uptime</th><th className="text-right px-4 py-2 font-medium">Actions</th>
        </tr></thead><tbody>
          {entries.map((e) => <tr key={e['.id']} className="border-b border-border/30 last:border-0 hover:bg-elevated/50 transition-colors">
            <td className="px-4 py-2 text-text-primary font-medium">{e.name}</td>
            <td className="px-4 py-2 text-text-secondary">{e.service}</td>
            <td className="px-4 py-2 font-mono text-text-muted text-xs">{e['caller-id'] || '—'}</td>
            <td className="px-4 py-2 font-mono text-text-secondary">{e.address || '—'}</td>
            <td className="px-4 py-2 text-text-secondary">{e.uptime || '—'}</td>
            <td className="px-4 py-2 text-right">
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-error hover:text-error" onClick={() => disconnectMutation.mutate(e['.id'])} disabled={disconnectMutation.isPending}>
                <XCircle className="h-3.5 w-3.5" />Disconnect
              </Button>
            </td>
          </tr>)}
        </tbody></table></div>
      )}
    </div>
  )
}
