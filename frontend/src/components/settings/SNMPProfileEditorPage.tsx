import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Upload,
  Loader2,
  X,
  Network,
  Copy,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import {
  snmpProfilesApi,
  type SNMPProfileResponse,
  type SNMPProfileCreate,
  type OIDNode,
} from '@/lib/api'
import { useAuth, canWrite } from '@/lib/auth'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { OIDTreeBrowser } from '@/components/settings/OIDTreeBrowser'
import { ProfileTestPanel } from '@/components/settings/ProfileTestPanel'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SNMPProfileEditorPageProps {
  tenantId: string
}

type ViewMode = 'list' | 'edit'

interface PollGroupOID {
  oid: string
  name: string
  type: string
}

interface PollGroup {
  interval_multiplier: number
  label: string
  scalars: PollGroupOID[]
  tables: unknown[]
}

type PollGroupKey = 'fast' | 'standard' | 'slow'

const CATEGORIES = [
  { value: 'generic', label: 'Generic' },
  { value: 'switch', label: 'Switch' },
  { value: 'router', label: 'Router' },
  { value: 'access_point', label: 'Access Point' },
  { value: 'ups', label: 'UPS' },
  { value: 'printer', label: 'Printer' },
  { value: 'server', label: 'Server' },
] as const

const DEFAULT_POLL_GROUPS: Record<PollGroupKey, PollGroup> = {
  fast: { interval_multiplier: 1, label: 'Fast (every poll)', scalars: [], tables: [] },
  standard: { interval_multiplier: 5, label: 'Standard (5x interval)', scalars: [], tables: [] },
  slow: { interval_multiplier: 30, label: 'Slow (30x interval)', scalars: [], tables: [] },
}

function buildEmptyPollGroups(): Record<PollGroupKey, PollGroup> {
  return {
    fast: { ...DEFAULT_POLL_GROUPS.fast, scalars: [], tables: [] },
    standard: { ...DEFAULT_POLL_GROUPS.standard, scalars: [], tables: [] },
    slow: { ...DEFAULT_POLL_GROUPS.slow, scalars: [], tables: [] },
  }
}

// ─── Profile Card ───────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  onEdit,
  onClone,
  onDelete,
  canModify,
}: {
  profile: SNMPProfileResponse
  onEdit: (profile: SNMPProfileResponse) => void
  onClone: (profile: SNMPProfileResponse) => void
  onDelete: (profileId: string) => void
  canModify: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-sm border border-border bg-panel group hover:border-border-hover transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{profile.name}</span>
            {profile.is_system && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                built-in
              </Badge>
            )}
            {profile.category && profile.category !== 'generic' && (
              <span className="text-[10px] text-text-muted capitalize">{profile.category}</span>
            )}
          </div>
          {profile.description && (
            <div className="text-xs text-text-muted truncate max-w-[450px] mt-0.5">
              {profile.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {profile.device_count > 0 && (
          <span className="text-[10px] text-text-muted tabular-nums">
            {profile.device_count} device{profile.device_count !== 1 ? 's' : ''}
          </span>
        )}
        {canModify && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {profile.is_system ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 px-2"
                onClick={() => onClone(profile)}
                title="Clone this profile to customize it"
              >
                <Copy className="h-3 w-3" />
                Clone
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(profile)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-error" onClick={() => onDelete(profile.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── OID Table Row ──────────────────────────────────────────────────────────

function OIDRow({
  oid,
  groupLabel,
  onRemove,
}: {
  oid: PollGroupOID
  groupLabel: string
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-1 px-2 text-xs group/row hover:bg-elevated/30 rounded-sm">
      <span className="font-mono text-text-primary w-40 truncate" title={oid.name}>{oid.name}</span>
      <span className="font-mono text-text-muted text-[10px] flex-1 truncate" title={oid.oid}>{oid.oid}</span>
      <span className="text-[10px] text-text-muted w-16 text-right">{oid.type}</span>
      <span className="text-[10px] text-text-muted w-20 text-right">{groupLabel}</span>
      <button
        type="button"
        className="text-text-muted hover:text-error opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function SNMPProfileEditorPage({ tenantId }: SNMPProfileEditorPageProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userCanWrite = canWrite(user)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── View state ────────────────────────────────────────────────────────

  const [view, setView] = useState<ViewMode>('list')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)

  // ─── Form state ────────────────────────────────────────────────────────

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [vendor, setVendor] = useState('')
  const [category, setCategory] = useState('generic')
  const [sysObjectId, setSysObjectId] = useState('')
  const [pollGroups, setPollGroups] = useState<Record<PollGroupKey, PollGroup>>(buildEmptyPollGroups)
  const [activePollGroup, setActivePollGroup] = useState<PollGroupKey>('standard')
  const [selectedOids, setSelectedOids] = useState<Set<string>>(new Set())
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // ─── MIB state ─────────────────────────────────────────────────────────

  const [parsedNodes, setParsedNodes] = useState<OIDNode[]>([])
  const [parsedModuleName, setParsedModuleName] = useState<string | null>(null)

  // ─── Manual OID add state ──────────────────────────────────────────────

  const [manualOid, setManualOid] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualType, setManualType] = useState('gauge32')
  const [manualGroup, setManualGroup] = useState<PollGroupKey>('standard')

  // ─── Data query ────────────────────────────────────────────────────────

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['snmp-profiles', tenantId],
    queryFn: () => snmpProfilesApi.list(tenantId),
    enabled: !!tenantId,
  })

  const systemProfiles = profiles?.filter((p) => p.is_system) ?? []
  const customProfiles = profiles?.filter((p) => !p.is_system) ?? []

  // ─── Mutations ─────────────────────────────────────────────────────────

  const parseMibMutation = useMutation({
    mutationFn: (file: File) => snmpProfilesApi.parseMib(tenantId, file),
    onSuccess: (data) => {
      setParsedNodes(data.nodes)
      setParsedModuleName(data.module_name)
      toast.success(`Parsed ${data.node_count} OIDs from ${data.module_name}`)
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to parse MIB file. Make sure dependencies are available.'
      toast.error(detail)
    },
  })

  const saveMutation = useMutation({
    mutationFn: (data: SNMPProfileCreate) =>
      editingProfileId
        ? snmpProfilesApi.update(tenantId, editingProfileId, data)
        : snmpProfilesApi.create(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['snmp-profiles', tenantId] })
      toast.success(editingProfileId ? 'Profile updated' : 'Profile created')
      resetAndGoToList()
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to save profile'
      toast.error(detail)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (profileId: string) => snmpProfilesApi.delete(tenantId, profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['snmp-profiles', tenantId] })
      toast.success('Profile deleted')
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Cannot delete profile'
      toast.error(detail)
    },
  })

  // ─── Helpers ───────────────────────────────────────────────────────────

  function resetAndGoToList() {
    setView('list')
    setEditingProfileId(null)
    setName('')
    setDescription('')
    setVendor('')
    setCategory('generic')
    setSysObjectId('')
    setPollGroups(buildEmptyPollGroups())
    setActivePollGroup('standard')
    setSelectedOids(new Set())
    setParsedNodes([])
    setParsedModuleName(null)
    setAdvancedOpen(false)
    setManualOid('')
    setManualName('')
  }

  function openCreate() {
    resetAndGoToList()
    setView('edit')
  }

  function openClone(profile: SNMPProfileResponse) {
    resetAndGoToList()
    setName(`${profile.name} (custom)`)
    setDescription(profile.description ?? '')
    setCategory(profile.category ?? 'generic')

    // Copy OIDs from the system profile
    const pd = profile.profile_data as {
      poll_groups?: Record<string, { interval_multiplier: number; scalars: PollGroupOID[]; tables: unknown[] }>
    } | null
    if (pd?.poll_groups) {
      const groups = buildEmptyPollGroups()
      for (const key of ['fast', 'standard', 'slow'] as PollGroupKey[]) {
        if (pd.poll_groups[key]) {
          groups[key] = {
            ...groups[key],
            interval_multiplier: pd.poll_groups[key].interval_multiplier,
            scalars: pd.poll_groups[key].scalars ?? [],
            tables: pd.poll_groups[key].tables ?? [],
          }
        }
      }
      setPollGroups(groups)
      const oids = new Set<string>()
      for (const g of Object.values(groups)) {
        for (const s of g.scalars) oids.add(s.oid)
      }
      setSelectedOids(oids)
    }

    setView('edit')
    toast.info(`Cloned from "${profile.name}" — customize and save as your own`)
  }

  function openEdit(profile: SNMPProfileResponse) {
    setEditingProfileId(profile.id)
    setName(profile.name)
    setDescription(profile.description ?? '')
    setVendor('')
    setCategory(profile.category ?? 'generic')
    setSysObjectId(profile.sys_object_id ?? '')

    const pd = profile.profile_data as {
      poll_groups?: Record<string, { interval_multiplier: number; scalars: PollGroupOID[]; tables: unknown[] }>
    } | null
    if (pd?.poll_groups) {
      const groups = buildEmptyPollGroups()
      for (const key of ['fast', 'standard', 'slow'] as PollGroupKey[]) {
        if (pd.poll_groups[key]) {
          groups[key] = {
            ...groups[key],
            interval_multiplier: pd.poll_groups[key].interval_multiplier,
            scalars: pd.poll_groups[key].scalars ?? [],
            tables: pd.poll_groups[key].tables ?? [],
          }
        }
      }
      setPollGroups(groups)
      const oids = new Set<string>()
      for (const g of Object.values(groups)) {
        for (const s of g.scalars) oids.add(s.oid)
      }
      setSelectedOids(oids)
    } else {
      setPollGroups(buildEmptyPollGroups())
      setSelectedOids(new Set())
    }

    setParsedNodes([])
    setParsedModuleName(null)
    setActivePollGroup('standard')
    setAdvancedOpen(false)
    setView('edit')
  }

  function handleDelete(profileId: string) {
    if (confirm('Delete this SNMP profile? Devices using it will fall back to the default profile.')) {
      deleteMutation.mutate(profileId)
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      parseMibMutation.mutate(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleToggleOid = useCallback(
    (oid: string, node: OIDNode) => {
      setSelectedOids((prev) => {
        const next = new Set(prev)
        if (next.has(oid)) {
          next.delete(oid)
          setPollGroups((pg) => {
            const updated = { ...pg }
            for (const key of ['fast', 'standard', 'slow'] as PollGroupKey[]) {
              updated[key] = { ...updated[key], scalars: updated[key].scalars.filter((s) => s.oid !== oid) }
            }
            return updated
          })
        } else {
          next.add(oid)
          setPollGroups((pg) => ({
            ...pg,
            [activePollGroup]: {
              ...pg[activePollGroup],
              scalars: [...pg[activePollGroup].scalars, { oid, name: node.name, type: node.type ?? 'string' }],
            },
          }))
        }
        return next
      })
    },
    [activePollGroup],
  )

  function handleRemoveOid(groupKey: PollGroupKey, index: number) {
    setPollGroups((pg) => {
      const removed = pg[groupKey].scalars[index]
      const updated = {
        ...pg,
        [groupKey]: { ...pg[groupKey], scalars: pg[groupKey].scalars.filter((_, i) => i !== index) },
      }
      if (removed) {
        setSelectedOids((prev) => {
          const next = new Set(prev)
          next.delete(removed.oid)
          return next
        })
      }
      return updated
    })
  }

  function handleManualAdd() {
    if (!manualOid.trim() || !manualName.trim()) return
    const oid: PollGroupOID = { oid: manualOid.trim(), name: manualName.trim(), type: manualType }
    setPollGroups((pg) => ({
      ...pg,
      [manualGroup]: { ...pg[manualGroup], scalars: [...pg[manualGroup].scalars, oid] },
    }))
    setSelectedOids((prev) => new Set(prev).add(oid.oid))
    setManualOid('')
    setManualName('')
    setManualType('gauge32')
  }

  function handleSave() {
    if (!name.trim()) {
      toast.error('Profile name is required')
      return
    }

    const profileData: Record<string, unknown> = {
      version: 1,
      poll_groups: {
        fast: { interval_multiplier: pollGroups.fast.interval_multiplier, scalars: pollGroups.fast.scalars, tables: pollGroups.fast.tables },
        standard: { interval_multiplier: pollGroups.standard.interval_multiplier, scalars: pollGroups.standard.scalars, tables: pollGroups.standard.tables },
        slow: { interval_multiplier: pollGroups.slow.interval_multiplier, scalars: pollGroups.slow.scalars, tables: pollGroups.slow.tables },
      },
    }

    const payload: SNMPProfileCreate = { name: name.trim(), profile_data: profileData }
    if (description.trim()) payload.description = description.trim()
    if (vendor.trim()) payload.vendor = vendor.trim()
    if (category !== 'generic') payload.category = category
    if (sysObjectId.trim()) payload.sys_object_id = sysObjectId.trim()

    saveMutation.mutate(payload)
  }

  // ─── Computed: all OIDs across groups for the flat table ───────────────

  const allOids: { oid: PollGroupOID; groupKey: PollGroupKey; groupLabel: string; index: number }[] = []
  for (const key of ['fast', 'standard', 'slow'] as PollGroupKey[]) {
    pollGroups[key].scalars.forEach((oid, index) => {
      allOids.push({ oid, groupKey: key, groupLabel: pollGroups[key].label, index })
    })
  }

  // ─── Loading state ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="h-8 w-48 bg-elevated/50 rounded animate-pulse" />
        <div className="h-24 bg-elevated/50 rounded animate-pulse" />
      </div>
    )
  }

  // ─── List View ────────────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">SNMP Profiles</h1>
            <p className="text-sm text-text-muted mt-0.5">
              Control what gets collected from each type of SNMP device
            </p>
          </div>
          {userCanWrite && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New Profile
            </Button>
          )}
        </div>

        {/* Built-in profiles */}
        {systemProfiles.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              Built-in Profiles
            </h2>
            <p className="text-xs text-text-muted mb-3">
              Ready to use. Clone one to customize it for your specific hardware.
            </p>
            <div className="space-y-1">
              {systemProfiles.map((p) => (
                <ProfileCard key={p.id} profile={p} onEdit={openEdit} onClone={openClone} onDelete={handleDelete} canModify={userCanWrite} />
              ))}
            </div>
          </div>
        )}

        {/* Custom profiles */}
        <div>
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            Custom Profiles
          </h2>
          <div className="space-y-1">
            {customProfiles.length === 0 ? (
              <div className="rounded-sm border border-border border-dashed bg-panel/50 px-4 py-6 text-center">
                <Network className="h-5 w-5 text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">No custom profiles yet</p>
                <p className="text-xs text-text-muted mt-1">
                  Clone a built-in profile above, or create one from scratch
                </p>
              </div>
            ) : (
              customProfiles.map((p) => (
                <ProfileCard key={p.id} profile={p} onEdit={openEdit} onClone={openClone} onDelete={handleDelete} canModify={userCanWrite} />
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── Edit View ────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetAndGoToList}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">
            {editingProfileId ? 'Edit Profile' : 'New SNMP Profile'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetAndGoToList}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : editingProfileId ? 'Save Changes' : 'Create Profile'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="basics" className="w-full">
        <TabsList>
          <TabsTrigger value="basics">Basics</TabsTrigger>
          <TabsTrigger value="oids">
            OIDs{allOids.length > 0 && ` (${allOids.length})`}
          </TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
          {editingProfileId && <TabsTrigger value="test">Test</TabsTrigger>}
        </TabsList>

        {/* ── Basics Tab ─────────────────────────────────────────────── */}
        <TabsContent value="basics" className="mt-4 space-y-4">
          <div className="rounded-sm border border-border bg-panel px-4 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Profile Name <span className="text-error">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ubiquiti EdgeSwitch" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this profile monitors" className="mt-1" />
            </div>
          </div>
        </TabsContent>

        {/* ── OIDs Tab ───────────────────────────────────────────────── */}
        <TabsContent value="oids" className="mt-4 space-y-4">
          {/* OID table */}
          <div className="rounded-sm border border-border bg-panel">
            {allOids.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-text-muted">No OIDs configured</p>
                <p className="text-xs text-text-muted mt-1">Add OIDs manually below, or use the Advanced tab to upload a vendor MIB file</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
                  <span className="w-40">Name</span>
                  <span className="flex-1">OID</span>
                  <span className="w-16 text-right">Type</span>
                  <span className="w-20 text-right">Interval</span>
                  <span className="w-4" />
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  {allOids.map(({ oid, groupKey, groupLabel, index }) => (
                    <OIDRow key={`${groupKey}-${oid.oid}-${index}`} oid={oid} groupLabel={groupLabel} onRemove={() => handleRemoveOid(groupKey, index)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick add */}
          <div className="rounded-sm border border-border bg-panel px-3 py-3">
            <h3 className="text-xs font-medium text-text-secondary mb-2">Add OID</h3>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-[10px] text-text-muted">OID</Label>
                <Input value={manualOid} onChange={(e) => setManualOid(e.target.value)} placeholder="1.3.6.1.2.1..." className="h-7 text-xs mt-0.5" />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-text-muted">Name</Label>
                <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="metric_name" className="h-7 text-xs mt-0.5" onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()} />
              </div>
              <div className="w-24">
                <Label className="text-[10px] text-text-muted">Type</Label>
                <Select value={manualType} onValueChange={setManualType}>
                  <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gauge32">Gauge</SelectItem>
                    <SelectItem value="counter32">Counter32</SelectItem>
                    <SelectItem value="counter64">Counter64</SelectItem>
                    <SelectItem value="integer">Integer</SelectItem>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="timeticks">TimeTicks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-24">
                <Label className="text-[10px] text-text-muted">Interval</Label>
                <Select value={manualGroup} onValueChange={(v) => setManualGroup(v as PollGroupKey)}>
                  <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fast">Fast</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="slow">Slow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleManualAdd} disabled={!manualOid.trim() || !manualName.trim()}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Advanced Tab ───────────────────────────────────────────── */}
        <TabsContent value="advanced" className="mt-4 space-y-4">
          {/* Auto-detection fields */}
          <div className="rounded-sm border border-border bg-panel px-4 py-4 space-y-4">
            <h3 className="text-xs font-medium text-text-secondary">Auto-Detection</h3>
            <p className="text-xs text-text-muted -mt-2">
              If set, TOD will automatically assign this profile when a device's sysObjectID matches the prefix below.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">sysObjectID Prefix</Label>
                <Input value={sysObjectId} onChange={(e) => setSysObjectId(e.target.value)} placeholder="1.3.6.1.4.1.41112" className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Vendor</Label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Ubiquiti" className="mt-1" />
              </div>
            </div>
          </div>

          {/* MIB Upload */}
          <div className="rounded-sm border border-border bg-panel px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-medium text-text-secondary">MIB Browser</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Upload a vendor MIB file to browse OIDs visually. Standard MIBs (IF-MIB, HOST-RESOURCES, etc.) are pre-loaded.
                </p>
              </div>
              {parsedModuleName && (
                <Badge variant="outline" className="text-[10px]">
                  {parsedModuleName}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input ref={fileInputRef} type="file" accept=".mib,.txt,.my" className="hidden" onChange={handleFileUpload} />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={parseMibMutation.isPending}>
                {parseMibMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {parseMibMutation.isPending ? 'Parsing...' : 'Upload MIB'}
              </Button>
            </div>

            {parsedNodes.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs text-text-muted">
                    Selecting OIDs adds them to:
                  </span>
                  <Select value={activePollGroup} onValueChange={(v) => setActivePollGroup(v as PollGroupKey)}>
                    <SelectTrigger className="h-6 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">Fast interval</SelectItem>
                      <SelectItem value="standard">Standard interval</SelectItem>
                      <SelectItem value="slow">Slow interval</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <OIDTreeBrowser nodes={parsedNodes} selectedOids={selectedOids} onToggleOid={handleToggleOid} />
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Test Tab ───────────────────────────────────────────────── */}
        {editingProfileId && (
          <TabsContent value="test" className="mt-4">
            <ProfileTestPanel tenantId={tenantId} profileId={editingProfileId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
