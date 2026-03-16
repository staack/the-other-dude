import { useState, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { authApi } from '@/lib/api'
import { getSMTPSettings, updateSMTPSettings, testSMTPSettings, clearWinboxSessions } from '@/lib/settingsApi'
import { SMTP_PRESETS } from '@/lib/smtpPresets'
import { User, Shield, Info, Key, Lock, ChevronRight, Download, Trash2, AlertTriangle, Mail, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChangePasswordForm } from './ChangePasswordForm'
import { toast } from 'sonner'

function SectionHeader({ icon: Icon, title }: { icon: React.FC<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-text-muted" />
      <h2 className="text-sm font-medium text-text-secondary">{title}</h2>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-text-muted w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-text-primary flex-1">{value ?? '—'}</span>
    </div>
  )
}

export function SettingsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      await authApi.exportMyData()
      toast.success('Data export downloaded successfully')
    } catch {
      toast.error('Failed to export data. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') return
    setIsDeleting(true)
    try {
      await authApi.deleteMyAccount('DELETE')
      toast.success('Account deleted successfully')
      await logout()
      navigate({ to: '/login' })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      toast.error(axiosErr?.response?.data?.detail || 'Failed to delete account')
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
      setDeleteConfirmation('')
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-text-muted mt-0.5">Account and system information</p>
      </div>

      {/* Account section */}
      <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1">
        <SectionHeader icon={User} title="Account" />
        <InfoRow label="Email" value={user?.email} />
        <InfoRow label="Role" value={
          <span className="capitalize">{user?.role?.replace(/_/g, ' ')}</span>
        } />
        <InfoRow label="Tenant ID" value={
          user?.tenant_id ? (
            <span className="font-mono text-xs">{user.tenant_id}</span>
          ) : (
            <span className="text-text-muted">Global (super admin)</span>
          )
        } />
      </div>

      {/* Password & Security section */}
      <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1">
        <SectionHeader icon={Lock} title="Password & Security" />
        <ChangePasswordForm />
      </div>

      {/* Permissions section */}
      <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1">
        <SectionHeader icon={Shield} title="Permissions" />
        <InfoRow label="Read devices" value="Yes" />
        <InfoRow
          label="Modify devices"
          value={user?.role === 'operator' || user?.role === 'tenant_admin' || user?.role === 'super_admin' ? 'Yes' : 'No'}
        />
        <InfoRow
          label="Delete devices"
          value={user?.role === 'tenant_admin' || user?.role === 'super_admin' ? 'Yes' : 'No'}
        />
        <InfoRow
          label="Manage organizations"
          value={isSuperAdmin(user) ? 'Yes (super admin)' : 'No'}
        />
      </div>

      {/* System info section */}
      <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1">
        <SectionHeader icon={Info} title="System" />
        <InfoRow label="API" value={
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-info hover:text-accent"
          >
            /api/docs (OpenAPI)
          </a>
        } />
        <InfoRow label="Version" value="v9.6" />
      </div>

      {/* Quick links */}
      {isTenantAdmin(user) && (
        <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1">
          <SectionHeader icon={Key} title="Integrations" />
          <Link
            to="/settings/api-keys"
            className="flex items-center justify-between py-2 px-1 rounded hover:bg-elevated/30 transition-colors group"
          >
            <div>
              <span className="text-sm text-text-primary">API Keys</span>
              <p className="text-xs text-text-muted">Manage keys for programmatic access</p>
            </div>
            <ChevronRight className="h-4 w-4 text-text-muted group-hover:text-text-primary transition-colors" />
          </Link>
        </div>
      )}

      {/* Maintenance — super_admin only */}
      {isSuperAdmin(user) && (
        <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-1">
          <SectionHeader icon={Monitor} title="Maintenance" />
          <div className="flex items-center justify-between py-2">
            <div>
              <span className="text-sm text-text-primary">Clear WinBox Sessions</span>
              <p className="text-xs text-text-muted">Remove stale sessions and rate limits from Redis</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const result = await clearWinboxSessions()
                  toast.success(`Cleared ${result.deleted} key${result.deleted !== 1 ? 's' : ''} from Redis`)
                } catch {
                  toast.error('Failed to clear WinBox sessions')
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* System Email (SMTP) — super_admin only */}
      {isSuperAdmin(user) && <SMTPSettingsSection />}

      {/* Data & Privacy section */}
      <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-3">
        <SectionHeader icon={Shield} title="Data & Privacy" />

        {/* Export Data */}
        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm text-text-primary">Export My Data</span>
            <p className="text-xs text-text-muted">Download all your personal data as JSON (GDPR Art. 20)</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportData}
            disabled={isExporting}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>

        {/* Privacy Policy link */}
        <div className="flex items-center justify-between py-2 border-t border-border/50">
          <div>
            <span className="text-sm text-text-primary">Privacy Policy</span>
            <p className="text-xs text-text-muted">View our data practices and your rights</p>
          </div>
          <Link to="/privacy" className="text-sm text-accent hover:underline">
            View
          </Link>
        </div>

        {/* Delete Account */}
        <div className="flex items-center justify-between py-2 border-t border-border/50">
          <div>
            <span className="text-sm text-destructive">Delete Account</span>
            <p className="text-xs text-text-muted">Permanently delete your account and all personal data</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open)
        if (!open) setDeleteConfirmation('')
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Account
            </DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All your personal data will be erased.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive font-medium">This will permanently:</p>
              <ul className="text-sm text-text-secondary mt-1 space-y-1 list-disc pl-4">
                <li>Delete your user account</li>
                <li>Remove all your API keys</li>
                <li>Erase your encryption keys</li>
                <li>Anonymize your audit log entries</li>
              </ul>
            </div>

            <div>
              <Label htmlFor="delete-confirm" className="text-sm text-text-secondary">
                Type <span className="font-mono font-bold text-text-primary">DELETE</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="DELETE"
                className="mt-1.5 font-mono"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteConfirmation !== 'DELETE' || isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete My Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SMTPSettingsSection() {
  const queryClient = useQueryClient()
  const { data: smtp, isLoading } = useQuery({
    queryKey: ['smtp-settings'],
    queryFn: getSMTPSettings,
  })

  const [provider, setProvider] = useState('custom')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(false)
  const [fromAddress, setFromAddress] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (smtp) {
      setProvider(smtp.smtp_provider || 'custom')
      setHost(smtp.smtp_host || '')
      setPort(String(smtp.smtp_port || 587))
      setSmtpUser(smtp.smtp_user || '')
      setUseTls(smtp.smtp_use_tls)
      setFromAddress(smtp.smtp_from_address || '')
    }
  }, [smtp])

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSMTPSettings({
        smtp_host: host,
        smtp_port: Number(port),
        smtp_user: smtpUser || undefined,
        smtp_password: password || undefined,
        smtp_use_tls: useTls,
        smtp_from_address: fromAddress,
        smtp_provider: provider,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['smtp-settings'] })
      toast.success('SMTP settings saved')
      setPassword('')
    },
    onError: () => toast.error('Failed to save SMTP settings'),
  })

  const handleProviderChange = (providerId: string) => {
    setProvider(providerId)
    const preset = SMTP_PRESETS.find((p) => p.id === providerId)
    if (preset && providerId !== 'custom') {
      setHost(preset.host)
      setPort(String(preset.port))
      setUseTls(preset.useTls)
    }
  }

  const handleTestAndSave = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testSMTPSettings({
        to: testTo,
        smtp_host: host,
        smtp_port: Number(port),
        smtp_user: smtpUser || undefined,
        smtp_password: password || undefined,
        smtp_use_tls: useTls,
        smtp_from_address: fromAddress,
      })
      setTestResult(result)
      if (result.success) {
        saveMutation.mutate()
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string }
      setTestResult({ success: false, message: err.response?.data?.message || err.message || 'Unknown error' })
    } finally {
      setTesting(false)
    }
  }

  if (isLoading) return null

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader icon={Mail} title="System Email (SMTP)" />
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
          smtp?.source === 'database'
            ? 'text-success bg-success/10'
            : 'text-text-muted bg-elevated'
        }`}>
          {smtp?.source === 'database' ? 'Database' : 'Environment'}
        </span>
      </div>

      <div>
        <Label className="text-xs">Email Provider</Label>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full rounded-md bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm mt-1"
        >
          {SMTP_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-text-muted">
          {SMTP_PRESETS.find((p) => p.id === provider)?.helpText}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">SMTP Host</Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} readOnly={provider !== 'custom'} />
        </div>
        <div>
          <Label className="text-xs">Port</Label>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} readOnly={provider !== 'custom'} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Username</Label>
          <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="user@example.com" />
        </div>
        <div>
          <Label className="text-xs">Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={smtp?.smtp_password_set ? '(unchanged)' : ''}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">From Address</Label>
          <Input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="noreply@example.com" />
        </div>
        <div>
          <Label className="text-xs">Test Recipient</Label>
          <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useTls}
          onChange={(e) => setUseTls(e.target.checked)}
          disabled={provider !== 'custom'}
          id="smtp-tls-settings"
          className="rounded"
        />
        <Label htmlFor="smtp-tls-settings" className="text-xs">Use TLS (port 465)</Label>
      </div>

      {testResult && (
        <p className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
          {testResult.message}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleTestAndSave}
          disabled={testing || !host || !testTo}
        >
          {testing ? 'Testing...' : 'Test & Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !host}
        >
          Save without Testing
        </Button>
      </div>
    </div>
  )
}

