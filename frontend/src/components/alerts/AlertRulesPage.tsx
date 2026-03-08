/**
 * AlertRulesPage — Alert rules and notification channels management.
 * Two-section page: rules table (top) and channels cards (bottom).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BellRing,
  Plus,
  Pencil,
  Trash2,
  Send,
  Mail,
  Globe,
  Hash,
} from 'lucide-react'
import {
  alertsApi,
  type AlertRule,
  type NotificationChannel,
  type AlertRuleCreateData,
  type ChannelCreateData,
} from '@/lib/alertsApi'
import { devicesApi, deviceGroupsApi } from '@/lib/api'
import { useUIStore } from '@/lib/store'
import { useAuth, isSuperAdmin, canWrite } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { SMTP_PRESETS } from '@/lib/smtpPresets'

const METRICS = [
  { value: 'cpu_load', label: 'CPU Load (%)' },
  { value: 'memory_used_pct', label: 'Memory Used (%)' },
  { value: 'disk_used_pct', label: 'Disk Used (%)' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'signal_strength', label: 'Signal Strength (dBm)' },
  { value: 'ccq', label: 'CCQ (%)' },
  { value: 'client_count', label: 'Client Count' },
]

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
]

function operatorLabel(op: string): string {
  return OPERATORS.find((o) => o.value === op)?.label ?? op
}

function metricLabel(metric: string): string {
  return METRICS.find((m) => m.value === metric)?.label ?? metric
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, string> = {
    critical: 'bg-error/20 text-error border-error/40',
    warning: 'bg-warning/20 text-warning border-warning/40',
    info: 'bg-info/20 text-info border-info/40',
  }
  return (
    <span
      className={cn(
        'text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border',
        config[severity] ?? config.info,
      )}
    >
      {severity}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Rule Form Dialog
// ---------------------------------------------------------------------------

function RuleFormDialog({
  open,
  onClose,
  tenantId,
  rule,
  channels,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  rule: AlertRule | null
  channels: NotificationChannel[]
}) {
  const queryClient = useQueryClient()
  const isEdit = !!rule

  const [name, setName] = useState(rule?.name ?? '')
  const [metric, setMetric] = useState(rule?.metric ?? 'cpu_load')
  const [operator, setOperator] = useState(rule?.operator ?? 'gt')
  const [threshold, setThreshold] = useState(String(rule?.threshold ?? 90))
  const [durationPolls, setDurationPolls] = useState(String(rule?.duration_polls ?? 3))
  const [severity, setSeverity] = useState(rule?.severity ?? 'warning')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [selectedChannels, setSelectedChannels] = useState<string[]>(rule?.channel_ids ?? [])

  const createMutation = useMutation({
    mutationFn: (data: AlertRuleCreateData) => alertsApi.createAlertRule(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast({ title: 'Alert rule created' })
      onClose()
    },
    onError: () => toast({ title: 'Failed to create rule', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: (data: AlertRuleCreateData) =>
      alertsApi.updateAlertRule(tenantId, rule!.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast({ title: 'Alert rule updated' })
      onClose()
    },
    onError: () => toast({ title: 'Failed to update rule', variant: 'destructive' }),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: AlertRuleCreateData = {
      name,
      metric,
      operator,
      threshold: Number(threshold),
      duration_polls: Number(durationPolls),
      severity,
      enabled,
      channel_ids: selectedChannels,
    }
    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Alert Rule' : 'New Alert Rule'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="High CPU usage"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Metric</Label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Operator</Label>
              <Select value={operator} onValueChange={setOperator}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Threshold</Label>
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Duration (consecutive checks)</Label>
              <Input
                type="number"
                min={1}
                value={durationPolls}
                onChange={(e) => setDurationPolls(e.target.value)}
                required
              />
              <p className="text-[10px] text-text-muted mt-0.5">
                Alert fires after threshold exceeded for this many poll cycles (~{Number(durationPolls) || 1} min)
              </p>
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {channels.length > 0 && (
            <div>
              <Label className="mb-2 block">Notification channels</Label>
              <div className="space-y-2">
                {channels.map((ch) => (
                  <label
                    key={ch.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedChannels.includes(ch.id)}
                      onCheckedChange={() => toggleChannel(ch.id)}
                    />
                    <span className="text-text-secondary">{ch.name}</span>
                    <span className="text-xs text-text-muted">
                      ({ch.channel_type})
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              checked={enabled}
              onCheckedChange={(v) => setEnabled(!!v)}
              id="rule-enabled"
            />
            <Label htmlFor="rule-enabled">Enabled</Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Channel Form Dialog
// ---------------------------------------------------------------------------

function ChannelFormDialog({
  open,
  onClose,
  tenantId,
  channel,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  channel: NotificationChannel | null
}) {
  const queryClient = useQueryClient()
  const isEdit = !!channel

  const [channelType, setChannelType] = useState<string>(channel?.channel_type ?? 'email')
  const [name, setName] = useState(channel?.name ?? '')
  // Email fields
  const [smtpHost, setSmtpHost] = useState(channel?.smtp_host ?? '')
  const [smtpPort, setSmtpPort] = useState(String(channel?.smtp_port ?? 587))
  const [smtpUser, setSmtpUser] = useState(channel?.smtp_user ?? '')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpUseTls, setSmtpUseTls] = useState(channel?.smtp_use_tls ?? true)
  const [fromAddress, setFromAddress] = useState(channel?.from_address ?? '')
  const [toAddress, setToAddress] = useState(channel?.to_address ?? '')
  // Provider preset
  const [smtpProvider, setSmtpProvider] = useState('custom')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  // Webhook fields
  const [webhookUrl, setWebhookUrl] = useState(channel?.webhook_url ?? '')
  // Slack fields
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(channel?.slack_webhook_url ?? '')

  const handleProviderChange = (providerId: string) => {
    setSmtpProvider(providerId)
    const preset = SMTP_PRESETS.find((p) => p.id === providerId)
    if (preset && providerId !== 'custom') {
      setSmtpHost(preset.host)
      setSmtpPort(String(preset.port))
      setSmtpUseTls(preset.useTls)
    }
  }

  const handleTestSmtp = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await alertsApi.testSmtp(tenantId, {
        smtp_host: smtpHost,
        smtp_port: Number(smtpPort),
        smtp_user: smtpUser || undefined,
        smtp_password: smtpPassword || undefined,
        smtp_use_tls: smtpUseTls,
        from_address: fromAddress || 'alerts@example.com',
        to_address: toAddress,
      })
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ success: false, message: e.response?.data?.detail || e.message })
    } finally {
      setTesting(false)
    }
  }

  const createMutation = useMutation({
    mutationFn: (data: ChannelCreateData) => alertsApi.createChannel(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
      toast({ title: 'Channel created' })
      onClose()
    },
    onError: () => toast({ title: 'Failed to create channel', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: (data: ChannelCreateData) =>
      alertsApi.updateChannel(tenantId, channel!.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
      toast({ title: 'Channel updated' })
      onClose()
    },
    onError: () => toast({ title: 'Failed to update channel', variant: 'destructive' }),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: ChannelCreateData = {
      name,
      channel_type: channelType as 'email' | 'webhook' | 'slack',
      ...(channelType === 'email'
        ? {
            smtp_host: smtpHost,
            smtp_port: Number(smtpPort),
            smtp_user: smtpUser,
            ...(smtpPassword ? { smtp_password: smtpPassword } : {}),
            smtp_use_tls: smtpUseTls,
            from_address: fromAddress,
            to_address: toAddress,
          }
        : channelType === 'slack'
          ? {
              slack_webhook_url: slackWebhookUrl,
            }
          : {
              webhook_url: webhookUrl,
            }),
    }
    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Notification Channel' : 'New Notification Channel'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ops email"
              required
            />
          </div>

          <Tabs value={channelType} onValueChange={setChannelType}>
            <TabsList className="w-full">
              <TabsTrigger value="email" className="flex-1">
                <Mail className="h-3 w-3 mr-1" /> Email
              </TabsTrigger>
              <TabsTrigger value="webhook" className="flex-1">
                <Globe className="h-3 w-3 mr-1" /> Webhook
              </TabsTrigger>
              <TabsTrigger value="slack" className="flex-1">
                <Hash className="h-3 w-3 mr-1" /> Slack
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="mt-3 space-y-3">
              <div>
                <Label>Email Provider</Label>
                <select
                  value={smtpProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full rounded-md bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm"
                >
                  {SMTP_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-muted">
                  {SMTP_PRESETS.find((p) => p.id === smtpProvider)?.helpText}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>SMTP Host</Label>
                  <Input
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com"
                    readOnly={smtpProvider !== 'custom'}
                  />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    readOnly={smtpProvider !== 'custom'}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username</Label>
                  <Input
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    placeholder={isEdit ? '(unchanged)' : ''}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From</Label>
                  <Input
                    value={fromAddress}
                    onChange={(e) => setFromAddress(e.target.value)}
                    placeholder="alerts@example.com"
                  />
                </div>
                <div>
                  <Label>To</Label>
                  <Input
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    placeholder="ops@example.com"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={smtpUseTls}
                  onCheckedChange={(v) => setSmtpUseTls(!!v)}
                  id="smtp-tls"
                  disabled={smtpProvider !== 'custom'}
                />
                <Label htmlFor="smtp-tls">Use TLS</Label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestSmtp}
                  disabled={testing || !smtpHost || !toAddress}
                  className="px-4 py-2 rounded-md bg-slate-600 text-white text-sm hover:bg-slate-500 disabled:opacity-50"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                {testResult && (
                  <p className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    {testResult.message}
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="webhook" className="mt-3">
              <div>
                <Label>Webhook URL</Label>
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>
            </TabsContent>

            <TabsContent value="slack" className="mt-3 space-y-3">
              <p className="text-xs text-text-muted">
                Create an Incoming Webhook in your Slack workspace settings, then paste the URL here.
              </p>
              <div>
                <Label>Slack Webhook URL</Label>
                <Input
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function AlertRulesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [ruleDialog, setRuleDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [channelDialog, setChannelDialog] = useState(false)
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null)

  const { selectedTenantId } = useUIStore()

  const tenantId = isSuperAdmin(user) ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  const { data: rules = [] } = useQuery({
    queryKey: ['alert-rules', tenantId],
    queryFn: () => alertsApi.getAlertRules(tenantId),
    enabled: !!tenantId,
  })

  const { data: channels = [] } = useQuery({
    queryKey: ['notification-channels', tenantId],
    queryFn: () => alertsApi.getNotificationChannels(tenantId),
    enabled: !!tenantId,
  })

  const toggleMutation = useMutation({
    mutationFn: (ruleId: string) => alertsApi.toggleAlertRule(tenantId, ruleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    },
    onError: () => toast({ title: 'Failed to toggle rule', variant: 'destructive' }),
  })

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => alertsApi.deleteAlertRule(tenantId, ruleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast({ title: 'Rule deleted' })
    },
    onError: () => toast({ title: 'Failed to delete rule', variant: 'destructive' }),
  })

  const deleteChannelMutation = useMutation({
    mutationFn: (channelId: string) => alertsApi.deleteChannel(tenantId, channelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
      toast({ title: 'Channel deleted' })
    },
    onError: () => toast({ title: 'Failed to delete channel', variant: 'destructive' }),
  })

  const testChannelMutation = useMutation({
    mutationFn: (channelId: string) => alertsApi.testChannel(tenantId, channelId),
    onSuccess: () => toast({ title: 'Test notification sent successfully' }),
    onError: () =>
      toast({ title: 'Test notification failed', variant: 'destructive' }),
  })

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BellRing className="h-5 w-5 text-text-muted" />
          <h1 className="text-lg font-semibold">Alert Rules</h1>
        </div>

        <div className="flex items-center gap-3" />
      </div>

      {/* ── Alert Rules Section ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-secondary">Threshold Rules</h2>
          {canWrite(user) && tenantId && (
            <Button
              size="sm"
              onClick={() => {
                setEditingRule(null)
                setRuleDialog(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add Rule
            </Button>
          )}
        </div>

        {!tenantId ? (
          <p className="text-sm text-text-muted py-6 text-center">
            Select an organization from the header to manage alert rules.
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">
            No alert rules configured.
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-xs text-text-muted font-medium">
              <span className="flex-1">Name</span>
              <span className="w-40">Condition</span>
              <span className="w-16">Severity</span>
              <span className="w-16 text-center">Enabled</span>
              <span className="w-20" />
            </div>
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 hover:bg-surface text-sm"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-text-primary truncate block">
                    {rule.name}
                    {rule.is_default && (
                      <span className="text-xs text-text-muted ml-2">(default)</span>
                    )}
                  </span>
                </div>
                <span className="w-40 text-xs text-text-muted font-mono">
                  {metricLabel(rule.metric)} {operatorLabel(rule.operator)}{' '}
                  {rule.threshold} for {rule.duration_polls}
                </span>
                <span className="w-16">
                  <SeverityBadge severity={rule.severity} />
                </span>
                <span className="w-16 text-center">
                  <button
                    onClick={() => toggleMutation.mutate(rule.id)}
                    className={cn(
                      'w-8 h-4 rounded-full relative transition-colors',
                      rule.enabled ? 'bg-success' : 'bg-border',
                    )}
                    disabled={!canWrite(user)}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                        rule.enabled ? 'left-4' : 'left-0.5',
                      )}
                    />
                  </button>
                </span>
                <span className="w-20 flex items-center gap-1 justify-end">
                  {canWrite(user) && (
                    <>
                      <button
                        onClick={() => {
                          setEditingRule(rule)
                          setRuleDialog(true)
                        }}
                        className="p-1 text-text-muted hover:text-text-secondary"
                        title="Edit rule"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!rule.is_default && (
                        <button
                          onClick={() => {
                            if (confirm(`Delete rule "${rule.name}"?`)) {
                              deleteRuleMutation.mutate(rule.id)
                            }
                          }}
                          className="p-1 text-text-muted hover:text-error"
                          title="Delete rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Notification Channels Section ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-secondary">Notification Channels</h2>
          {canWrite(user) && tenantId && (
            <Button
              size="sm"
              onClick={() => {
                setEditingChannel(null)
                setChannelDialog(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add Channel
            </Button>
          )}
        </div>

        {!tenantId ? (
          <p className="text-sm text-text-muted py-6 text-center">
            Select an organization from the header to manage channels.
          </p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">
            No notification channels configured.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="rounded-lg border border-border bg-surface p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {ch.channel_type === 'email' ? (
                      <Mail className="h-4 w-4 text-info" />
                    ) : ch.channel_type === 'slack' ? (
                      <Hash className="h-4 w-4 text-chart-4" />
                    ) : (
                      <Globe className="h-4 w-4 text-chart-5" />
                    )}
                    <span className="text-sm font-medium text-text-primary">{ch.name}</span>
                    <span className="text-[10px] uppercase text-text-muted border border-border rounded px-1">
                      {ch.channel_type}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-text-muted truncate">
                  {ch.channel_type === 'email'
                    ? ch.to_address ?? ch.from_address ?? 'No address'
                    : ch.channel_type === 'slack'
                      ? ch.slack_webhook_url
                        ? ch.slack_webhook_url.slice(0, 50) + '...'
                        : 'No URL'
                      : ch.webhook_url
                        ? ch.webhook_url.slice(0, 50) + '...'
                        : 'No URL'}
                </p>
                {canWrite(user) && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => testChannelMutation.mutate(ch.id)}
                      disabled={testChannelMutation.isPending}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Test
                    </Button>
                    <button
                      onClick={() => {
                        setEditingChannel(ch)
                        setChannelDialog(true)
                      }}
                      className="p-1 text-text-muted hover:text-text-secondary"
                      title="Edit channel"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete channel "${ch.name}"?`)) {
                          deleteChannelMutation.mutate(ch.id)
                        }
                      }}
                      className="p-1 text-text-muted hover:text-error"
                      title="Delete channel"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Dialogs */}
      {ruleDialog && (
        <RuleFormDialog
          open={ruleDialog}
          onClose={() => {
            setRuleDialog(false)
            setEditingRule(null)
          }}
          tenantId={tenantId}
          rule={editingRule}
          channels={channels}
        />
      )}
      {channelDialog && (
        <ChannelFormDialog
          open={channelDialog}
          onClose={() => {
            setChannelDialog(false)
            setEditingChannel(null)
          }}
          tenantId={tenantId}
          channel={editingChannel}
        />
      )}
    </div>
  )
}
