import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Key, Plus, Copy, Trash2, AlertTriangle, Check } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import {
  apiKeysApi,
  type ApiKeyResponse,
  type ApiKeyCreateResponse,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

const AVAILABLE_SCOPES = [
  { id: 'devices:read', label: 'Devices: Read' },
  { id: 'devices:write', label: 'Devices: Write' },
  { id: 'config:read', label: 'Config: Read' },
  { id: 'config:write', label: 'Config: Write' },
  { id: 'alerts:read', label: 'Alerts: Read' },
  { id: 'firmware:write', label: 'Firmware: Write' },
] as const

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString()
}

function getKeyStatus(key: ApiKeyResponse): {
  label: string
  className: string
} {
  if (key.revoked_at) {
    return { label: 'Revoked', className: 'border-border bg-elevated/50 text-text-muted' }
  }
  if (key.expires_at && new Date(key.expires_at) <= new Date()) {
    return { label: 'Expired', className: 'border-error/30 bg-error/10 text-error' }
  }
  return { label: 'Active', className: 'border-success/30 bg-success/10 text-success' }
}

interface ApiKeysPageProps {
  tenantId: string
}

export function ApiKeysPage({ tenantId }: ApiKeysPageProps) {
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showKeyDialog, setShowKeyDialog] = useState(false)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyResponse | null>(null)
  const [newKey, setNewKey] = useState<ApiKeyCreateResponse | null>(null)
  const [copied, setCopied] = useState(false)

  // Create form state
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [expiresAt, setExpiresAt] = useState('')

  const keysQuery = useQuery({
    queryKey: ['api-keys', tenantId],
    queryFn: () => apiKeysApi.list(tenantId),
    enabled: !!tenantId,
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; scopes: string[]; expires_at?: string }) =>
      apiKeysApi.create(tenantId, data),
    onSuccess: (data) => {
      setNewKey(data)
      setShowCreateDialog(false)
      setShowKeyDialog(true)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['api-keys', tenantId] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => apiKeysApi.revoke(tenantId, keyId),
    onSuccess: () => {
      setShowRevokeDialog(false)
      setRevokeTarget(null)
      queryClient.invalidateQueries({ queryKey: ['api-keys', tenantId] })
    },
  })

  function resetForm() {
    setName('')
    setSelectedScopes([])
    setExpiresAt('')
  }

  function handleCreate() {
    const data: { name: string; scopes: string[]; expires_at?: string } = {
      name,
      scopes: selectedScopes,
    }
    if (expiresAt) {
      data.expires_at = new Date(expiresAt).toISOString()
    }
    createMutation.mutate(data)
  }

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }

  async function copyKey() {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const keys = keysQuery.data ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-text-muted" />
            <h1 className="text-lg font-semibold">API Keys</h1>
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            Create and manage API keys for programmatic access
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4" />
          Create API Key
        </Button>
      </div>

      {/* Key list */}
      {keys.length === 0 && !keysQuery.isLoading ? (
        <EmptyState
          icon={Key}
          title="No API keys"
          description="Create API keys for programmatic access to the portal."
          action={{ label: 'Create API Key', onClick: () => setShowCreateDialog(true) }}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-elevated/30">
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Name</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Key</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Scopes</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Last Used</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Expires</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Status</th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const status = getKeyStatus(key)
                const isInactive = !!key.revoked_at
                return (
                  <tr
                    key={key.id}
                    className={`border-b border-border/50 last:border-0 ${isInactive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono bg-elevated/50 px-1.5 py-0.5 rounded">
                        {key.key_prefix}...
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} className="text-[10px]">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {formatRelativeTime(key.last_used_at)}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {formatDate(key.expires_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!key.revoked_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-error hover:text-error hover:bg-error/10"
                          onClick={() => {
                            setRevokeTarget(key)
                            setShowRevokeDialog(true)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Revoke
                        </Button>
                      )}
                      {key.revoked_at && (
                        <span className="text-xs text-text-muted">
                          Revoked {formatDate(key.revoked_at)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create API Key Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for programmatic access. Choose which scopes the key should have
              access to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Key Name
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-border-bright bg-elevated/50 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                placeholder="e.g. Monitoring Integration"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Scopes */}
            <div>
              <label className="text-sm font-medium text-text-secondary block mb-2">
                Permissions
              </label>
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_SCOPES.map((scope) => (
                  <label
                    key={scope.id}
                    className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 hover:bg-elevated/30 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedScopes.includes(scope.id)}
                      onCheckedChange={() => toggleScope(scope.id)}
                    />
                    <span className="text-sm">{scope.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Expiry */}
            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Expiry Date{' '}
                <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                type="date"
                className="w-full rounded-md border border-border-bright bg-elevated/50 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || selectedScopes.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-Time Key Display Dialog */}
      <Dialog
        open={showKeyDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowKeyDialog(false)
            setNewKey(null)
            setCopied(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy your API key now. You will not be able to see it again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                <p className="text-xs text-warning">
                  This key will not be shown again. Store it securely.
                </p>
              </div>
            </div>

            <div className="relative">
              <pre className="rounded-lg border border-border bg-elevated/50 p-4 font-mono text-sm break-all whitespace-pre-wrap">
                {newKey?.key}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={copyKey}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setShowKeyDialog(false)
                setNewKey(null)
                setCopied(false)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <Dialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke{' '}
              <span className="font-medium text-text-primary">{revokeTarget?.name}</span>? This
              action cannot be undone and will immediately prevent any requests using this key.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevokeDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? 'Revoking...' : 'Revoke Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
