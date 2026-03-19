import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  alertRulesApi,
  type SiteAlertRuleResponse,
  type SiteAlertRuleCreate,
  type SiteAlertRuleUpdate,
} from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

const RULE_TYPES = {
  device_offline_percent: { label: 'Device offline %', unit: '%' },
  device_offline_count: { label: 'Device offline count', unit: 'devices' },
  sector_signal_avg: { label: 'Sector avg signal', unit: 'dBm' },
  sector_client_drop: { label: 'Sector client drop %', unit: '%' },
} as const

type RuleType = keyof typeof RULE_TYPES

interface AlertRuleFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string
  siteId: string
  sectorId?: string
  rule?: SiteAlertRuleResponse | null
  onSaved?: () => void
}

export function AlertRuleFormDialog({
  open,
  onOpenChange,
  tenantId,
  siteId,
  sectorId,
  rule,
  onSaved,
}: AlertRuleFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = !!rule

  const [name, setName] = useState('')
  const [ruleType, setRuleType] = useState<RuleType>('device_offline_percent')
  const [thresholdValue, setThresholdValue] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)

  // Filter rule types based on whether we have a sector context
  const availableTypes = sectorId
    ? (['sector_signal_avg', 'sector_client_drop'] as RuleType[])
    : (['device_offline_percent', 'device_offline_count'] as RuleType[])

  useEffect(() => {
    if (rule) {
      setName(rule.name)
      setRuleType(rule.rule_type as RuleType)
      setThresholdValue(String(rule.threshold_value))
      setDescription(rule.description ?? '')
      setEnabled(rule.enabled)
    } else {
      setName('')
      setRuleType(availableTypes[0])
      setThresholdValue('')
      setDescription('')
      setEnabled(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, open])

  const unit = RULE_TYPES[ruleType]?.unit ?? ''

  const createMutation = useMutation({
    mutationFn: (data: SiteAlertRuleCreate) => alertRulesApi.create(tenantId, siteId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', tenantId, siteId] })
      onOpenChange(false)
      onSaved?.()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: SiteAlertRuleUpdate) => alertRulesApi.update(tenantId, siteId, rule!.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', tenantId, siteId] })
      onOpenChange(false)
      onSaved?.()
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const threshold = parseFloat(thresholdValue)
    if (isNaN(threshold)) return

    if (isEdit) {
      updateMutation.mutate({
        name: name.trim(),
        threshold_value: threshold,
        threshold_unit: unit,
        description: description.trim() || undefined,
        enabled,
      })
    } else {
      createMutation.mutate({
        name: name.trim(),
        rule_type: ruleType,
        threshold_value: threshold,
        threshold_unit: unit,
        sector_id: sectorId,
        description: description.trim() || undefined,
        enabled,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Alert Rule' : 'Add Alert Rule'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update alert rule settings.'
              : 'Create a rule to trigger alerts when conditions are met.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Name *</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alert when offline > 20%"
              required
            />
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="rule-type">Rule Type *</Label>
              <Select value={ruleType} onValueChange={(v) => setRuleType(v as RuleType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {RULE_TYPES[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rule-threshold">
              Threshold ({unit}) *
            </Label>
            <Input
              id="rule-threshold"
              type="number"
              step="any"
              value={thresholdValue}
              onChange={(e) => setThresholdValue(e.target.value)}
              placeholder={unit === 'dBm' ? '-75' : '20'}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-description">Description</Label>
            <textarea
              id="rule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details about this rule..."
              rows={2}
              className="flex w-full rounded-md border border-border bg-elevated/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rule-enabled"
              checked={enabled}
              onCheckedChange={(v) => setEnabled(v === true)}
            />
            <Label htmlFor="rule-enabled" className="text-sm font-normal">
              Enabled
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !thresholdValue || isPending}>
              {isEdit ? 'Save Changes' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
