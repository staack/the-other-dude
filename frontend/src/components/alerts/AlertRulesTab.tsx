import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { alertRulesApi, type SiteAlertRuleResponse } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AlertRuleFormDialog } from './AlertRuleFormDialog'

const RULE_TYPE_LABELS: Record<string, string> = {
  device_offline_percent: 'Offline %',
  device_offline_count: 'Offline count',
  sector_signal_avg: 'Avg signal',
  sector_client_drop: 'Client drop %',
}

interface AlertRulesTabProps {
  tenantId: string
  siteId: string
  sectorId?: string
}

export function AlertRulesTab({ tenantId, siteId, sectorId }: AlertRulesTabProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<SiteAlertRuleResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['alert-rules', tenantId, siteId, sectorId],
    queryFn: () => alertRulesApi.list(tenantId, siteId, sectorId),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      alertRulesApi.update(tenantId, siteId, ruleId, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', tenantId, siteId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => alertRulesApi.delete(tenantId, siteId, ruleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', tenantId, siteId] })
    },
  })

  function handleEdit(rule: SiteAlertRuleResponse) {
    setEditingRule(rule)
    setDialogOpen(true)
  }

  function handleDelete(ruleId: string) {
    if (window.confirm('Delete this alert rule?')) {
      deleteMutation.mutate(ruleId)
    }
  }

  function handleAdd() {
    setEditingRule(null)
    setDialogOpen(true)
  }

  const rules = data?.items ?? []

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-elevated/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Alert Rules</h3>
        <Button size="sm" variant="ghost" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Rule
        </Button>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-text-muted">Loading rules...</div>
      ) : rules.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-text-muted mb-3">No alert rules configured</p>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Alert Rule
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">Name</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-left">Type</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">Threshold</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-center">Enabled</th>
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border/50 hover:bg-elevated/50 transition-colors">
                  <td className="px-2 py-1.5 text-text-primary">{rule.name}</td>
                  <td className="px-2 py-1.5 text-text-secondary text-xs">
                    {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {rule.threshold_value} {rule.threshold_unit}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => toggleMutation.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                      className={`w-8 h-4 rounded-full relative transition-colors ${
                        rule.enabled ? 'bg-success' : 'bg-elevated'
                      }`}
                      aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      <span
                        className={`block w-3 h-3 rounded-full bg-white transition-transform absolute top-0.5 ${
                          rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleEdit(rule)}
                        className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
                        aria-label="Edit rule"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="p-1 rounded text-text-muted hover:text-error transition-colors"
                        aria-label="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertRuleFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenantId={tenantId}
        siteId={siteId}
        sectorId={sectorId}
        rule={editingRule}
      />
    </div>
  )
}
