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
  fast: { interval_multiplier: 1, label: 'Fast (60s)', scalars: [], tables: [] },
  standard: { interval_multiplier: 5, label: 'Standard (5m)', scalars: [], tables: [] },
  slow: { interval_multiplier: 30, label: 'Slow (30m)', scalars: [], tables: [] },
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
  onDelete,
  canModify,
}: {
  profile: SNMPProfileResponse
  onEdit: (profile: SNMPProfileResponse) => void
  onDelete: (profileId: string) => void
  canModify: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-sm border border-border bg-panel">
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{profile.name}</span>
            {profile.is_system && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                system
              </Badge>
            )}
          </div>
          {profile.description && (
            <div className="text-xs text-text-muted truncate max-w-[400px]">
              {profile.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-text-muted">
          {profile.device_count} device{profile.device_count !== 1 ? 's' : ''}
        </span>
        {canModify && !profile.is_system && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(profile)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-error"
              onClick={() => onDelete(profile.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Manual OID Add Row ─────────────────────────────────────────────────────

function ManualOIDAddRow({
  onAdd,
}: {
  onAdd: (oid: PollGroupOID) => void
}) {
  const [oid, setOid] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('gauge32')

  function handleAdd() {
    if (!oid.trim() || !name.trim()) return
    onAdd({ oid: oid.trim(), name: name.trim(), type })
    setOid('')
    setName('')
    setType('gauge32')
  }

  return (
    <div className="flex items-end gap-2 mt-2">
      <div className="flex-1">
        <Label className="text-[10px] text-text-muted">OID</Label>
        <Input
          value={oid}
          onChange={(e) => setOid(e.target.value)}
          placeholder="1.3.6.1.2.1..."
          className="h-7 text-xs"
        />
      </div>
      <div className="flex-1">
        <Label className="text-[10px] text-text-muted">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="metric_name"
          className="h-7 text-xs"
        />
      </div>
      <div className="w-28">
        <Label className="text-[10px] text-text-muted">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gauge32">Gauge32</SelectItem>
            <SelectItem value="counter32">Counter32</SelectItem>
            <SelectItem value="counter64">Counter64</SelectItem>
            <SelectItem value="integer">Integer</SelectItem>
            <SelectItem value="string">String</SelectItem>
            <SelectItem value="timeticks">TimeTicks</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleAdd}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  )
}

// ─── Poll Group Section ─────────────────────────────────────────────────────

function PollGroupSection({
  groupKey,
  group,
  isActive,
  onSetActive,
  onRemoveOid,
  onAddOid,
}: {
  groupKey: PollGroupKey
  group: PollGroup
  isActive: boolean
  onSetActive: () => void
  onRemoveOid: (groupKey: PollGroupKey, index: number) => void
  onAddOid: (groupKey: PollGroupKey, oid: PollGroupOID) => void
}) {
  return (
    <div
      className={`rounded-sm border px-3 py-2 ${isActive ? 'border-accent bg-accent/5' : 'border-border bg-panel'}`}
    >
      <div className="flex items-center justify-between mb-1">
        <button
          type="button"
          className="text-sm font-medium text-text-secondary hover:text-text-primary"
          onClick={onSetActive}
        >
          {group.label}
          {isActive && (
            <span className="ml-2 text-[10px] text-accent font-normal">
              (active -- tree selections go here)
            </span>
          )}
        </button>
        <span className="text-[10px] text-text-muted">
          {group.scalars.length} OID{group.scalars.length !== 1 ? 's' : ''}
        </span>
      </div>
      {group.scalars.length > 0 && (
        <div className="space-y-0.5">
          {group.scalars.map((s, i) => (
            <div
              key={`${s.oid}-${i}`}
              className="flex items-center justify-between gap-2 text-xs py-0.5"
            >
              <span className="font-mono text-text-primary truncate">{s.name}</span>
              <span className="font-mono text-text-muted text-[10px] truncate flex-shrink-0">
                {s.oid}
              </span>
              <span className="text-[10px] bg-surface-raised px-1 py-0.5 rounded flex-shrink-0">
                {s.type}
              </span>
              <button
                type="button"
                className="text-text-muted hover:text-error flex-shrink-0"
                onClick={() => onRemoveOid(groupKey, i)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ManualOIDAddRow onAdd={(oid) => onAddOid(groupKey, oid)} />
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

  // ─── MIB state ─────────────────────────────────────────────────────────

  const [parsedNodes, setParsedNodes] = useState<OIDNode[]>([])
  const [parsedModuleName, setParsedModuleName] = useState<string | null>(null)

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
        'Failed to parse MIB file'
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
  }

  function openCreate() {
    resetAndGoToList()
    setView('edit')
  }

  function openEdit(profile: SNMPProfileResponse) {
    setEditingProfileId(profile.id)
    setName(profile.name)
    setDescription(profile.description ?? '')
    setVendor('')
    setCategory('generic')
    setSysObjectId('')

    // Parse existing profile_data poll groups
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

      // Rebuild selected OIDs set from existing poll groups
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
    // Reset input so re-uploading the same file works
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleToggleOid = useCallback(
    (oid: string, node: OIDNode) => {
      setSelectedOids((prev) => {
        const next = new Set(prev)
        if (next.has(oid)) {
          next.delete(oid)
          // Remove from whichever poll group contains it
          setPollGroups((pg) => {
            const updated = { ...pg }
            for (const key of ['fast', 'standard', 'slow'] as PollGroupKey[]) {
              updated[key] = {
                ...updated[key],
                scalars: updated[key].scalars.filter((s) => s.oid !== oid),
              }
            }
            return updated
          })
        } else {
          next.add(oid)
          // Add to the active poll group
          setPollGroups((pg) => ({
            ...pg,
            [activePollGroup]: {
              ...pg[activePollGroup],
              scalars: [
                ...pg[activePollGroup].scalars,
                { oid, name: node.name, type: node.type ?? 'string' },
              ],
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
        [groupKey]: {
          ...pg[groupKey],
          scalars: pg[groupKey].scalars.filter((_, i) => i !== index),
        },
      }
      // Also remove from selected set
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

  function handleManualAdd(groupKey: PollGroupKey, oid: PollGroupOID) {
    setPollGroups((pg) => ({
      ...pg,
      [groupKey]: {
        ...pg[groupKey],
        scalars: [...pg[groupKey].scalars, oid],
      },
    }))
    setSelectedOids((prev) => new Set(prev).add(oid.oid))
  }

  function handleSave() {
    if (!name.trim()) {
      toast.error('Profile name is required')
      return
    }

    const profileData: Record<string, unknown> = {
      version: 1,
      poll_groups: {
        fast: {
          interval_multiplier: pollGroups.fast.interval_multiplier,
          scalars: pollGroups.fast.scalars,
          tables: pollGroups.fast.tables,
        },
        standard: {
          interval_multiplier: pollGroups.standard.interval_multiplier,
          scalars: pollGroups.standard.scalars,
          tables: pollGroups.standard.tables,
        },
        slow: {
          interval_multiplier: pollGroups.slow.interval_multiplier,
          scalars: pollGroups.slow.scalars,
          tables: pollGroups.slow.tables,
        },
      },
    }

    const payload: SNMPProfileCreate = {
      name: name.trim(),
      profile_data: profileData,
    }
    if (description.trim()) payload.description = description.trim()
    if (vendor.trim()) payload.vendor = vendor.trim()
    if (category !== 'generic') payload.category = category
    if (sysObjectId.trim()) payload.sys_object_id = sysObjectId.trim()

    saveMutation.mutate(payload)
  }

  // ─── Loading state ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="h-8 w-48 bg-elevated/50 rounded animate-pulse" />
        <div className="h-24 bg-elevated/50 rounded animate-pulse" />
        <div className="h-24 bg-elevated/50 rounded animate-pulse" />
      </div>
    )
  }

  // ─── List View ────────────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">SNMP Profiles</h1>
            <p className="text-sm text-text-muted mt-0.5">
              Manage SNMP polling profiles for device monitoring
            </p>
          </div>
          {userCanWrite && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New Profile
            </Button>
          )}
        </div>

        {/* System profiles */}
        {systemProfiles.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-text-secondary mb-2">System Profiles</h2>
            <div className="space-y-1.5">
              {systemProfiles.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  canModify={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Custom profiles */}
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-2">Custom Profiles</h2>
          <div className="space-y-1.5">
            {customProfiles.length === 0 ? (
              <EmptyState
                icon={Network}
                title="No custom profiles"
                description="Create a custom SNMP profile to monitor vendor-specific OIDs"
                action={userCanWrite ? { label: 'New Profile', onClick: openCreate } : undefined}
              />
            ) : (
              customProfiles.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  canModify={userCanWrite}
                />
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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetAndGoToList}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold">
          {editingProfileId ? 'Edit SNMP Profile' : 'New SNMP Profile'}
        </h1>
      </div>

      {/* Profile Fields */}
      <div className="rounded-sm border border-border bg-panel px-3 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">
              Profile Name <span className="text-error">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ubiquiti EdgeSwitch"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">
              Category
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs">
            Description <span className="text-text-muted font-normal">(optional)</span>
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this profile"
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">
              Vendor <span className="text-text-muted font-normal">(optional)</span>
            </Label>
            <Input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Ubiquiti"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">
              sysObjectID <span className="text-text-muted font-normal">(optional)</span>
            </Label>
            <Input
              value={sysObjectId}
              onChange={(e) => setSysObjectId(e.target.value)}
              placeholder="1.3.6.1.4.1...."
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {/* MIB Upload */}
      <div className="rounded-sm border border-border bg-panel px-3 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-secondary">MIB Upload</h2>
          {parsedModuleName && (
            <span className="text-xs text-text-muted">
              Module: {parsedModuleName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mib,.txt,.my"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={parseMibMutation.isPending}
          >
            {parseMibMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {parseMibMutation.isPending ? 'Parsing...' : 'Upload MIB'}
          </Button>
          <p className="text-xs text-text-muted">
            Upload a vendor MIB file (.mib, .txt, .my) to browse and select OIDs
          </p>
        </div>

        {parsedNodes.length > 0 && (
          <OIDTreeBrowser
            nodes={parsedNodes}
            selectedOids={selectedOids}
            onToggleOid={handleToggleOid}
          />
        )}
      </div>

      {/* Poll Groups */}
      <div className="rounded-sm border border-border bg-panel px-3 py-3 space-y-3">
        <h2 className="text-sm font-medium text-text-secondary">Poll Groups</h2>
        <p className="text-xs text-text-muted">
          Assign OIDs to poll groups with different collection intervals. Click a group header to
          make it active -- OIDs selected in the tree above will be added to the active group.
        </p>
        <div className="space-y-2">
          {(['fast', 'standard', 'slow'] as PollGroupKey[]).map((key) => (
            <PollGroupSection
              key={key}
              groupKey={key}
              group={pollGroups[key]}
              isActive={activePollGroup === key}
              onSetActive={() => setActivePollGroup(key)}
              onRemoveOid={handleRemoveOid}
              onAddOid={handleManualAdd}
            />
          ))}
        </div>
      </div>

      {/* Test Panel */}
      <ProfileTestPanel tenantId={tenantId} profileId={editingProfileId} />

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 pb-4">
        <Button onClick={handleSave} disabled={!name.trim() || saveMutation.isPending}>
          {saveMutation.isPending
            ? 'Saving...'
            : editingProfileId
              ? 'Update Profile'
              : 'Create Profile'}
        </Button>
        <Button variant="outline" onClick={resetAndGoToList}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
