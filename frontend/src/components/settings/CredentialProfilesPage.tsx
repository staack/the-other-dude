import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, KeyRound, Shield } from 'lucide-react'
import {
  credentialProfilesApi,
  type CredentialProfileResponse,
  type CredentialProfileCreate,
} from '@/lib/api'
import { useAuth, canWrite } from '@/lib/auth'
import { toast } from 'sonner'
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface CredentialProfilesPageProps {
  tenantId: string
}

type CredentialType = 'routeros' | 'snmp_v2c' | 'snmp_v3'
type SecurityLevel = 'no_auth_no_priv' | 'auth_no_priv' | 'auth_priv'

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  routeros: 'RouterOS',
  snmp_v2c: 'SNMP v2c',
  snmp_v3: 'SNMP v3',
}

const SECURITY_LEVELS: { value: SecurityLevel; label: string }[] = [
  { value: 'no_auth_no_priv', label: 'No Auth, No Privacy' },
  { value: 'auth_no_priv', label: 'Auth, No Privacy' },
  { value: 'auth_priv', label: 'Auth and Privacy' },
]

const AUTH_PROTOCOLS = ['SHA256', 'SHA384', 'SHA512'] as const
const PRIVACY_PROTOCOLS = ['AES128', 'AES256'] as const

// ─── Profile Card ───────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  onEdit,
  onDelete,
  canModify,
}: {
  profile: CredentialProfileResponse
  onEdit: (profile: CredentialProfileResponse) => void
  onDelete: (profileId: string) => void
  canModify: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-sm border border-border bg-panel">
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="text-sm font-medium text-text-primary">{profile.name}</div>
          {profile.description && (
            <div className="text-xs text-text-muted truncate max-w-[300px]">
              {profile.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-text-muted">
          {profile.device_count} device{profile.device_count !== 1 ? 's' : ''}
        </span>
        {canModify && (
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

// ─── Main Component ─────────────────────────────────────────────────────────

export function CredentialProfilesPage({ tenantId }: CredentialProfilesPageProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userCanWrite = canWrite(user)

  // ─── Data query ─────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['credential-profiles', tenantId],
    queryFn: () => credentialProfilesApi.list(tenantId),
    enabled: !!tenantId,
  })

  const profiles = data?.profiles ?? []
  const routerosProfiles = profiles.filter((p) => p.credential_type === 'routeros')
  const snmpProfiles = profiles.filter((p) => p.credential_type.startsWith('snmp_'))

  // ─── Dialog state ───────────────────────────────────────────────────────

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<CredentialProfileResponse | null>(
    null,
  )
  const [form, setForm] = useState<CredentialProfileCreate>({
    name: '',
    credential_type: 'routeros',
  })

  function closeDialog() {
    setDialogOpen(false)
    setEditingProfile(null)
    setForm({ name: '', credential_type: 'routeros' })
  }

  function openCreateDialog() {
    setEditingProfile(null)
    setForm({ name: '', credential_type: 'routeros' })
    setDialogOpen(true)
  }

  function handleEdit(profile: CredentialProfileResponse) {
    setEditingProfile(profile)
    setForm({
      name: profile.name,
      description: profile.description ?? '',
      credential_type: profile.credential_type,
    })
    setDialogOpen(true)
  }

  function updateForm(updates: Partial<CredentialProfileCreate>) {
    setForm((prev) => ({ ...prev, ...updates }))
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (data: CredentialProfileCreate) =>
      editingProfile
        ? credentialProfilesApi.update(tenantId, editingProfile.id, data)
        : credentialProfilesApi.create(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['credential-profiles'] })
      toast.success(editingProfile ? 'Profile updated' : 'Profile created')
      closeDialog()
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to save profile'
      toast.error(detail)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (profileId: string) =>
      credentialProfilesApi.delete(tenantId, profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['credential-profiles'] })
      toast.success('Profile deleted')
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Cannot delete profile'
      toast.error(detail)
    },
  })

  function handleDelete(profileId: string) {
    if (
      confirm(
        "Delete this credential profile? Devices using it will keep their current credentials but won't receive future updates.",
      )
    ) {
      deleteMutation.mutate(profileId)
    }
  }

  function handleSave() {
    // Strip empty string fields so we don't send blanks to the API
    const payload: CredentialProfileCreate = { ...form }
    for (const key of Object.keys(payload) as (keyof CredentialProfileCreate)[]) {
      if (payload[key] === '') {
        delete payload[key]
      }
    }
    // Always send name and credential_type
    payload.name = form.name
    payload.credential_type = form.credential_type
    saveMutation.mutate(payload)
  }

  // ─── Loading state ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="h-8 w-48 bg-elevated/50 rounded animate-pulse" />
        <div className="h-24 bg-elevated/50 rounded animate-pulse" />
        <div className="h-24 bg-elevated/50 rounded animate-pulse" />
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const credType = form.credential_type as CredentialType
  const secLevel = (form.security_level ?? 'no_auth_no_priv') as SecurityLevel

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Credential Profiles</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Manage shared credentials for device authentication
          </p>
        </div>
        {userCanWrite && (
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-3.5 w-3.5" /> New Profile
          </Button>
        )}
      </div>

      {/* RouterOS section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-medium text-text-secondary">RouterOS</h2>
        </div>
        <div className="space-y-1.5">
          {routerosProfiles.length === 0 ? (
            <p className="text-xs text-text-muted py-2">
              No RouterOS credential profiles yet
            </p>
          ) : (
            routerosProfiles.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                onEdit={handleEdit}
                onDelete={handleDelete}
                canModify={userCanWrite}
              />
            ))
          )}
        </div>
      </div>

      {/* SNMP section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-medium text-text-secondary">SNMP</h2>
        </div>
        <div className="space-y-1.5">
          {snmpProfiles.length === 0 ? (
            <p className="text-xs text-text-muted py-2">
              No SNMP credential profiles yet
            </p>
          ) : (
            snmpProfiles.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                onEdit={handleEdit}
                onDelete={handleDelete}
                canModify={userCanWrite}
              />
            ))
          )}
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? 'Edit Credential Profile' : 'New Credential Profile'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Credential type */}
            <div>
              <Label className="text-xs">Credential Type</Label>
              <Select
                value={form.credential_type}
                onValueChange={(v) => updateForm({ credential_type: v })}
                disabled={!!editingProfile}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routeros">RouterOS</SelectItem>
                  <SelectItem value="snmp_v2c">SNMP v2c</SelectItem>
                  <SelectItem value="snmp_v3">SNMP v3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div>
              <Label className="text-xs">Profile Name</Label>
              <Input
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="e.g. monitoring-readonly"
                className="mt-1"
              />
            </div>

            {/* Description */}
            <div>
              <Label className="text-xs">
                Description{' '}
                <span className="text-text-muted font-normal">(optional)</span>
              </Label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => updateForm({ description: e.target.value })}
                placeholder="Brief description of this profile"
                className="mt-1"
              />
            </div>

            {/* RouterOS fields */}
            {credType === 'routeros' && (
              <>
                <div>
                  <Label className="text-xs">Username</Label>
                  <Input
                    value={form.username ?? ''}
                    onChange={(e) => updateForm({ username: e.target.value })}
                    placeholder={editingProfile ? 'Leave blank to keep current' : 'admin'}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Password</Label>
                  <Input
                    type="password"
                    value={form.password ?? ''}
                    onChange={(e) => updateForm({ password: e.target.value })}
                    placeholder={editingProfile ? 'Leave blank to keep current' : ''}
                    className="mt-1"
                  />
                </div>
              </>
            )}

            {/* SNMP v2c fields */}
            {credType === 'snmp_v2c' && (
              <div>
                <Label className="text-xs">Community String</Label>
                <Input
                  value={form.community ?? ''}
                  onChange={(e) => updateForm({ community: e.target.value })}
                  placeholder={editingProfile ? 'Leave blank to keep current' : 'public'}
                  className="mt-1"
                />
              </div>
            )}

            {/* SNMP v3 fields */}
            {credType === 'snmp_v3' && (
              <>
                <div>
                  <Label className="text-xs">Security Name</Label>
                  <Input
                    value={form.security_name ?? ''}
                    onChange={(e) => updateForm({ security_name: e.target.value })}
                    placeholder={
                      editingProfile ? 'Leave blank to keep current' : 'snmpuser'
                    }
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-xs">Security Level</Label>
                  <Select
                    value={form.security_level ?? 'no_auth_no_priv'}
                    onValueChange={(v) => updateForm({ security_level: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SECURITY_LEVELS.map((sl) => (
                        <SelectItem key={sl.value} value={sl.value}>
                          {sl.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Auth fields (auth_no_priv or auth_priv) */}
                {(secLevel === 'auth_no_priv' || secLevel === 'auth_priv') && (
                  <>
                    <div>
                      <Label className="text-xs">Auth Protocol</Label>
                      <Select
                        value={form.auth_protocol ?? 'SHA256'}
                        onValueChange={(v) => updateForm({ auth_protocol: v })}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AUTH_PROTOCOLS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Auth Passphrase</Label>
                      <Input
                        type="password"
                        value={form.auth_passphrase ?? ''}
                        onChange={(e) =>
                          updateForm({ auth_passphrase: e.target.value })
                        }
                        placeholder={
                          editingProfile ? 'Leave blank to keep current' : ''
                        }
                        className="mt-1"
                      />
                    </div>
                  </>
                )}

                {/* Privacy fields (auth_priv only) */}
                {secLevel === 'auth_priv' && (
                  <>
                    <div>
                      <Label className="text-xs">Privacy Protocol</Label>
                      <Select
                        value={form.privacy_protocol ?? 'AES128'}
                        onValueChange={(v) => updateForm({ privacy_protocol: v })}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIVACY_PROTOCOLS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Privacy Passphrase</Label>
                      <Input
                        type="password"
                        value={form.privacy_passphrase ?? ''}
                        onChange={(e) =>
                          updateForm({ privacy_passphrase: e.target.value })
                        }
                        placeholder={
                          editingProfile ? 'Leave blank to keep current' : ''
                        }
                        className="mt-1"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending
                ? 'Saving...'
                : editingProfile
                  ? 'Update Profile'
                  : 'Create Profile'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
