/**
 * WifiPanel -- WiFi/SSID management with RouterOS version-aware path selection.
 *
 * RouterOS 6: /interface/wireless + /interface/wireless/security-profiles
 * RouterOS 7+: /interface/wifi (security embedded in config)
 *
 * Provides two sub-tabs:
 * 1. Wireless Interfaces -- SSID, band, channel, security
 * 2. Security Profiles (RouterOS 6 only) -- authentication, passphrases
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Wifi,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  Eye,
  EyeOff,
  Shield,
  Radio,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useConfigBrowse } from '@/hooks/useConfigPanel'
import { useConfigPanel } from '@/hooks/useConfigPanel'
import { SafetyToggle } from '@/components/config/SafetyToggle'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import type { ConfigPanelProps, ConfigChange } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WifiPanelProps extends ConfigPanelProps {
  routerosVersion?: string | null
}

interface WirelessFormData {
  ssid: string
  band: string
  'channel-width': string
  frequency: string
  'security-profile': string
  disabled: string
  // RouterOS 7 fields
  'security.passphrase': string
}

interface SecurityProfileFormData {
  name: string
  mode: string
  'authentication-types': string
  'wpa-pre-shared-key': string
  'wpa2-pre-shared-key': string
}

type SubTab = 'interfaces' | 'security-profiles'

// ---------------------------------------------------------------------------
// Version Detection
// ---------------------------------------------------------------------------

function parseMajorVersion(version: string | null | undefined): number {
  if (!version) return 6
  const match = version.match(/^(\d+)/)
  return match ? parseInt(match[1], 10) : 6
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BAND_OPTIONS = [
  { value: '2ghz-b', label: '2.4 GHz B' },
  { value: '2ghz-b/g', label: '2.4 GHz B/G' },
  { value: '2ghz-b/g/n', label: '2.4 GHz B/G/N' },
  { value: '2ghz-g/n', label: '2.4 GHz G/N' },
  { value: '2ghz-onlyn', label: '2.4 GHz N Only' },
  { value: '5ghz-a', label: '5 GHz A' },
  { value: '5ghz-a/n', label: '5 GHz A/N' },
  { value: '5ghz-a/n/ac', label: '5 GHz A/N/AC' },
  { value: '5ghz-onlyac', label: '5 GHz AC Only' },
  { value: '5ghz-n/ac', label: '5 GHz N/AC' },
]

const CHANNEL_WIDTH_OPTIONS = ['20mhz', '20/40mhz-XX', '20/40mhz-Ce', '20/40mhz-eC', '40mhz-turbo', '20/40/80mhz-XXXX', '80mhz']

const SECURITY_MODE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'static-keys-required', label: 'Static Keys Required' },
  { value: 'static-keys-optional', label: 'Static Keys Optional' },
  { value: 'dynamic-keys', label: 'Dynamic Keys' },
]

const AUTH_TYPE_OPTIONS = ['wpa-psk', 'wpa2-psk', 'wpa-eap', 'wpa2-eap']

// ---------------------------------------------------------------------------
// WifiPanel Component
// ---------------------------------------------------------------------------

export function WifiPanel({ tenantId, deviceId, active, routerosVersion }: WifiPanelProps) {
  const majorVersion = useMemo(() => parseMajorVersion(routerosVersion), [routerosVersion])
  const isV7 = majorVersion >= 7
  const wirelessPath = isV7 ? '/interface/wifi' : '/interface/wireless'

  const [subTab, setSubTab] = useState<SubTab>('interfaces')
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<Record<string, string> | null>(null)
  const [secProfileDialogOpen, setSecProfileDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Record<string, string> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Data loading
  const { entries: interfaces, isLoading: loadingInterfaces, error: ifError } = useConfigBrowse(
    tenantId, deviceId, wirelessPath, { enabled: active },
  )
  const { entries: securityProfiles, isLoading: loadingSecurity } = useConfigBrowse(
    tenantId, deviceId, '/interface/wireless/security-profiles',
    { enabled: active && !isV7 },
  )

  // Config panel state
  const {
    pendingChanges, applyMode, setApplyMode,
    addChange, clearChanges, applyChanges, isApplying,
  } = useConfigPanel(tenantId, deviceId, 'wifi')

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleEditInterface = useCallback((entry: Record<string, string>) => {
    setEditingEntry(entry)
    setEditDialogOpen(true)
  }, [])

  const handleToggleDisabled = useCallback((entry: Record<string, string>) => {
    const isDisabled = entry.disabled === 'true' || entry.disabled === 'yes'
    const change: ConfigChange = {
      operation: 'set',
      path: wirelessPath,
      entryId: entry['.id'],
      properties: { disabled: isDisabled ? 'no' : 'yes' },
      description: `${isDisabled ? 'Enable' : 'Disable'} wireless interface "${entry.name}"`,
    }
    addChange(change)
  }, [wirelessPath, addChange])

  const handleDeleteInterface = useCallback((entry: Record<string, string>) => {
    const change: ConfigChange = {
      operation: 'remove',
      path: wirelessPath,
      entryId: entry['.id'],
      properties: {},
      description: `Remove wireless interface "${entry.name}"`,
    }
    addChange(change)
  }, [wirelessPath, addChange])

  const handleSaveInterface = useCallback((formData: WirelessFormData) => {
    const properties: Record<string, string> = {}
    if (formData.ssid) properties.ssid = formData.ssid
    if (formData.band) properties.band = formData.band
    if (formData['channel-width']) properties['channel-width'] = formData['channel-width']
    if (formData.frequency) properties.frequency = formData.frequency
    if (!isV7 && formData['security-profile']) {
      properties['security-profile'] = formData['security-profile']
    }
    if (isV7 && formData['security.passphrase']) {
      properties['security.passphrase'] = formData['security.passphrase']
    }
    properties.disabled = formData.disabled

    if (editingEntry) {
      const change: ConfigChange = {
        operation: 'set',
        path: wirelessPath,
        entryId: editingEntry['.id'],
        properties,
        description: `Update wireless interface "${editingEntry.name}" (SSID: ${formData.ssid || editingEntry.ssid || 'unchanged'})`,
      }
      addChange(change)
    }
    setEditDialogOpen(false)
    setEditingEntry(null)
  }, [editingEntry, wirelessPath, isV7, addChange])

  const handleEditProfile = useCallback((profile: Record<string, string>) => {
    setEditingProfile(profile)
    setSecProfileDialogOpen(true)
  }, [])

  const handleAddProfile = useCallback(() => {
    setEditingProfile(null)
    setSecProfileDialogOpen(true)
  }, [])

  const handleDeleteProfile = useCallback((profile: Record<string, string>) => {
    const change: ConfigChange = {
      operation: 'remove',
      path: '/interface/wireless/security-profiles',
      entryId: profile['.id'],
      properties: {},
      description: `Remove security profile "${profile.name}"`,
    }
    addChange(change)
  }, [addChange])

  const handleSaveProfile = useCallback((formData: SecurityProfileFormData) => {
    const properties: Record<string, string> = {
      name: formData.name,
      mode: formData.mode,
      'authentication-types': formData['authentication-types'],
    }
    if (formData['wpa-pre-shared-key']) {
      properties['wpa-pre-shared-key'] = formData['wpa-pre-shared-key']
    }
    if (formData['wpa2-pre-shared-key']) {
      properties['wpa2-pre-shared-key'] = formData['wpa2-pre-shared-key']
    }

    if (editingProfile) {
      addChange({
        operation: 'set',
        path: '/interface/wireless/security-profiles',
        entryId: editingProfile['.id'],
        properties,
        description: `Update security profile "${formData.name}"`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/interface/wireless/security-profiles',
        properties,
        description: `Add security profile "${formData.name}"`,
      })
    }
    setSecProfileDialogOpen(false)
    setEditingProfile(null)
  }, [editingProfile, addChange])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (ifError) {
    return (
      <div className="flex items-center gap-2 p-6 text-error">
        <AlertCircle className="h-4 w-4" />
        <span>Failed to load wireless interfaces: {ifError.message}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">WiFi Management</h3>
          <Badge className="text-[10px]">
            {isV7 ? 'RouterOS 7+' : 'RouterOS 6'}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <SafetyToggle mode={applyMode} onModeChange={setApplyMode} />
          {pendingChanges.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge className="bg-accent/20 text-accent border-accent/40">
                {pendingChanges.length} pending
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearChanges}>
                Clear
              </Button>
              <Button size="sm" onClick={() => setPreviewOpen(true)}>
                Review & Apply
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setSubTab('interfaces')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
            subTab === 'interfaces'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary',
          )}
        >
          <span className="flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            Wireless Interfaces
          </span>
        </button>
        {!isV7 && (
          <button
            onClick={() => setSubTab('security-profiles')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
              subTab === 'security-profiles'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Security Profiles
            </span>
          </button>
        )}
      </div>

      {/* Tab Content */}
      {subTab === 'interfaces' && (
        <WirelessInterfacesTable
          entries={interfaces}
          isLoading={loadingInterfaces}
          isV7={isV7}
          onEdit={handleEditInterface}
          onToggle={handleToggleDisabled}
          onDelete={handleDeleteInterface}
        />
      )}

      {subTab === 'security-profiles' && !isV7 && (
        <SecurityProfilesTable
          entries={securityProfiles}
          isLoading={loadingSecurity}
          onEdit={handleEditProfile}
          onAdd={handleAddProfile}
          onDelete={handleDeleteProfile}
        />
      )}

      {/* Edit Wireless Interface Dialog */}
      <WirelessEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        entry={editingEntry}
        isV7={isV7}
        securityProfiles={securityProfiles}
        onSave={handleSaveInterface}
      />

      {/* Security Profile Dialog */}
      {!isV7 && (
        <SecurityProfileDialog
          open={secProfileDialogOpen}
          onOpenChange={setSecProfileDialogOpen}
          profile={editingProfile}
          onSave={handleSaveProfile}
        />
      )}

      {/* Change Preview Modal */}
      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={pendingChanges}
        applyMode={applyMode}
        onConfirm={applyChanges}
        isApplying={isApplying}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wireless Interfaces Table
// ---------------------------------------------------------------------------

function WirelessInterfacesTable({
  entries,
  isLoading,
  isV7,
  onEdit,
  onToggle,
  onDelete,
}: {
  entries: Record<string, string>[]
  isLoading: boolean
  isV7: boolean
  onEdit: (entry: Record<string, string>) => void
  onToggle: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading wireless interfaces...
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-secondary gap-2">
        <Wifi className="h-8 w-8 opacity-40" />
        <p className="text-sm">No wireless interfaces detected on this device.</p>
        <p className="text-xs text-text-muted">This device may not have WiFi hardware.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-elevated/50 border-b border-border">
            <th className="text-left px-3 py-2 text-text-secondary font-medium">Status</th>
            <th className="text-left px-3 py-2 text-text-secondary font-medium">Name</th>
            <th className="text-left px-3 py-2 text-text-secondary font-medium">SSID</th>
            <th className="text-left px-3 py-2 text-text-secondary font-medium">Band</th>
            <th className="text-left px-3 py-2 text-text-secondary font-medium">Channel Width</th>
            <th className="text-left px-3 py-2 text-text-secondary font-medium">Frequency</th>
            {!isV7 && (
              <th className="text-left px-3 py-2 text-text-secondary font-medium">Security</th>
            )}
            <th className="text-right px-3 py-2 text-text-secondary font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const isDisabled = entry.disabled === 'true' || entry.disabled === 'yes'
            // RouterOS 7 may nest ssid under configuration
            const ssid = entry.ssid || entry['configuration.ssid'] || entry['configuration'] || ''
            return (
              <tr
                key={entry['.id'] || i}
                className="border-b border-border last:border-0 hover:bg-elevated/30 transition-colors"
              >
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-block h-2 w-2 rounded-full',
                      isDisabled ? 'bg-text-muted' : 'bg-success',
                    )}
                    title={isDisabled ? 'Disabled' : 'Enabled'}
                  />
                </td>
                <td className="px-3 py-2 text-text-primary font-medium">{entry.name}</td>
                <td className="px-3 py-2 font-mono text-text-primary">{ssid || '-'}</td>
                <td className="px-3 py-2 text-text-secondary text-xs">{entry.band || '-'}</td>
                <td className="px-3 py-2 text-text-secondary text-xs">{entry['channel-width'] || '-'}</td>
                <td className="px-3 py-2 text-text-secondary text-xs">{entry.frequency || '-'}</td>
                {!isV7 && (
                  <td className="px-3 py-2 text-text-secondary text-xs">
                    {entry['security-profile'] || '-'}
                  </td>
                )}
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(entry)} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onToggle(entry)}
                      title={isDisabled ? 'Enable' : 'Disable'}
                    >
                      {isDisabled ? (
                        <Power className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <PowerOff className="h-3.5 w-3.5 text-text-muted" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(entry)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5 text-error" />
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Security Profiles Table (RouterOS 6 only)
// ---------------------------------------------------------------------------

function SecurityProfilesTable({
  entries,
  isLoading,
  onEdit,
  onAdd,
  onDelete,
}: {
  entries: Record<string, string>[]
  isLoading: boolean
  onEdit: (profile: Record<string, string>) => void
  onAdd: () => void
  onDelete: (profile: Record<string, string>) => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading security profiles...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Profile
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-secondary gap-2">
          <Shield className="h-8 w-8 opacity-40" />
          <p className="text-sm">No security profiles configured.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-elevated/50 border-b border-border">
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Name</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Auth Types</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Mode</th>
                <th className="text-right px-3 py-2 text-text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((profile, i) => (
                <tr
                  key={profile['.id'] || i}
                  className="border-b border-border last:border-0 hover:bg-elevated/30 transition-colors"
                >
                  <td className="px-3 py-2 text-text-primary font-medium">{profile.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(profile['authentication-types'] || '').split(',').filter(Boolean).map((t) => (
                        <Badge key={t} className="text-[10px]">{t.trim()}</Badge>
                      ))}
                      {!profile['authentication-types'] && (
                        <span className="text-text-muted text-xs">none</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs">{profile.mode || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(profile)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(profile)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5 text-error" />
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
  )
}

// ---------------------------------------------------------------------------
// Wireless Edit Dialog
// ---------------------------------------------------------------------------

function WirelessEditDialog({
  open,
  onOpenChange,
  entry,
  isV7,
  securityProfiles,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  isV7: boolean
  securityProfiles: Record<string, string>[]
  onSave: (data: WirelessFormData) => void
}) {
  const [showPassphrase, setShowPassphrase] = useState(false)

  const [formData, setFormData] = useState<WirelessFormData>({
    ssid: '',
    band: '',
    'channel-width': '',
    frequency: '',
    'security-profile': '',
    disabled: 'no',
    'security.passphrase': '',
  })

  // Reset form when entry changes
  useEffect(() => {
    if (entry) {
      setFormData({
        ssid: entry.ssid || entry['configuration.ssid'] || '',
        band: entry.band || '',
        'channel-width': entry['channel-width'] || '',
        frequency: entry.frequency || '',
        'security-profile': entry['security-profile'] || '',
        disabled: entry.disabled || 'no',
        'security.passphrase': entry['security.passphrase'] || '',
      })
    }
  }, [entry])

  // Use effect-like pattern to reset form on dialog open
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && entry) {
      setFormData({
        ssid: entry.ssid || entry['configuration.ssid'] || '',
        band: entry.band || '',
        'channel-width': entry['channel-width'] || '',
        frequency: entry.frequency || '',
        'security-profile': entry['security-profile'] || '',
        disabled: entry.disabled || 'no',
        'security.passphrase': entry['security.passphrase'] || '',
      })
      setShowPassphrase(false)
    }
    onOpenChange(nextOpen)
  }, [entry, onOpenChange])

  const updateField = useCallback((field: keyof WirelessFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Wireless Interface</DialogTitle>
          <DialogDescription>
            {entry?.name ? `Editing "${entry.name}"` : 'Edit wireless settings'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* SSID */}
          <div className="space-y-1.5">
            <Label htmlFor="wifi-ssid">SSID</Label>
            <Input
              id="wifi-ssid"
              value={formData.ssid}
              onChange={(e) => updateField('ssid', e.target.value)}
              placeholder="Network name"
              className="font-mono"
            />
          </div>

          {/* Band */}
          <div className="space-y-1.5">
            <Label>Band</Label>
            <Select value={formData.band} onValueChange={(v) => updateField('band', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select band" />
              </SelectTrigger>
              <SelectContent>
                {BAND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Channel Width */}
          <div className="space-y-1.5">
            <Label>Channel Width</Label>
            <Select value={formData['channel-width']} onValueChange={(v) => updateField('channel-width', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select channel width" />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_WIDTH_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label htmlFor="wifi-freq">Frequency (optional)</Label>
            <Input
              id="wifi-freq"
              value={formData.frequency}
              onChange={(e) => updateField('frequency', e.target.value)}
              placeholder="e.g. 2412, 5180"
            />
          </div>

          {/* Security Profile (v6) or Passphrase (v7) */}
          {isV7 ? (
            <div className="space-y-1.5">
              <Label htmlFor="wifi-passphrase">Passphrase</Label>
              <div className="relative">
                <Input
                  id="wifi-passphrase"
                  type={showPassphrase ? 'text' : 'password'}
                  value={formData['security.passphrase']}
                  onChange={(e) => updateField('security.passphrase', e.target.value)}
                  placeholder="WiFi password"
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showPassphrase ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Security Profile</Label>
              <Select
                value={formData['security-profile']}
                onValueChange={(v) => updateField('security-profile', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {securityProfiles.map((sp) => (
                    <SelectItem key={sp['.id'] || sp.name} value={sp.name}>
                      {sp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Disabled */}
          <div className="flex items-center gap-2">
            <input
              id="wifi-disabled"
              type="checkbox"
              checked={formData.disabled === 'yes' || formData.disabled === 'true'}
              onChange={(e) => updateField('disabled', e.target.checked ? 'yes' : 'no')}
              className="rounded border-border"
            />
            <Label htmlFor="wifi-disabled">Disabled</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSave(formData)}>
            Stage Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Security Profile Dialog (RouterOS 6 only)
// ---------------------------------------------------------------------------

function SecurityProfileDialog({
  open,
  onOpenChange,
  profile,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Record<string, string> | null
  onSave: (data: SecurityProfileFormData) => void
}) {
  const [showWpa, setShowWpa] = useState(false)
  const [showWpa2, setShowWpa2] = useState(false)
  const isEditing = !!profile

  const [formData, setFormData] = useState<SecurityProfileFormData>({
    name: '',
    mode: 'dynamic-keys',
    'authentication-types': 'wpa2-psk',
    'wpa-pre-shared-key': '',
    'wpa2-pre-shared-key': '',
  })

  // Reset on open
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      if (profile) {
        setFormData({
          name: profile.name || '',
          mode: profile.mode || 'dynamic-keys',
          'authentication-types': profile['authentication-types'] || '',
          'wpa-pre-shared-key': '',
          'wpa2-pre-shared-key': '',
        })
      } else {
        setFormData({
          name: '',
          mode: 'dynamic-keys',
          'authentication-types': 'wpa2-psk',
          'wpa-pre-shared-key': '',
          'wpa2-pre-shared-key': '',
        })
      }
      setShowWpa(false)
      setShowWpa2(false)
    }
    onOpenChange(nextOpen)
  }, [profile, onOpenChange])

  const updateField = useCallback((field: keyof SecurityProfileFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const toggleAuthType = useCallback((authType: string) => {
    setFormData((prev) => {
      const types = prev['authentication-types'].split(',').map((t) => t.trim()).filter(Boolean)
      const idx = types.indexOf(authType)
      if (idx >= 0) {
        types.splice(idx, 1)
      } else {
        types.push(authType)
      }
      return { ...prev, 'authentication-types': types.join(',') }
    })
  }, [])

  const selectedAuthTypes = formData['authentication-types'].split(',').map((t) => t.trim()).filter(Boolean)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Security Profile' : 'Add Security Profile'}</DialogTitle>
          <DialogDescription>
            {isEditing ? `Editing "${profile?.name}"` : 'Create a new wireless security profile'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sp-name">Name *</Label>
            <Input
              id="sp-name"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Profile name"
              disabled={isEditing}
            />
          </div>

          {/* Mode */}
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select value={formData.mode} onValueChange={(v) => updateField('mode', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                {SECURITY_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Authentication Types */}
          <div className="space-y-1.5">
            <Label>Authentication Types</Label>
            <div className="flex flex-wrap gap-2">
              {AUTH_TYPE_OPTIONS.map((authType) => (
                <label key={authType} className="flex items-center gap-1.5 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={selectedAuthTypes.includes(authType)}
                    onChange={() => toggleAuthType(authType)}
                    className="rounded border-border"
                  />
                  {authType}
                </label>
              ))}
            </div>
          </div>

          {/* WPA Pre-Shared Key */}
          <div className="space-y-1.5">
            <Label htmlFor="sp-wpa-key">WPA Pre-Shared Key</Label>
            <div className="relative">
              <Input
                id="sp-wpa-key"
                type={showWpa ? 'text' : 'password'}
                value={formData['wpa-pre-shared-key']}
                onChange={(e) => updateField('wpa-pre-shared-key', e.target.value)}
                placeholder="WPA passphrase"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowWpa(!showWpa)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                {showWpa ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* WPA2 Pre-Shared Key */}
          <div className="space-y-1.5">
            <Label htmlFor="sp-wpa2-key">WPA2 Pre-Shared Key</Label>
            <div className="relative">
              <Input
                id="sp-wpa2-key"
                type={showWpa2 ? 'text' : 'password'}
                value={formData['wpa2-pre-shared-key']}
                onChange={(e) => updateField('wpa2-pre-shared-key', e.target.value)}
                placeholder="WPA2 passphrase"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowWpa2(!showWpa2)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                {showWpa2 ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSave(formData)} disabled={!formData.name}>
            {isEditing ? 'Stage Change' : 'Stage Addition'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
