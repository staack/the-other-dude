/**
 * FirewallPanel — Firewall rule editor with visual builder, table view,
 * action color coding, rule reordering, and NAT management.
 *
 * CFG-03: Displays filter rules and NAT rules in separate sub-tabs,
 * provides a visual rule builder form, and supports move up/down reordering.
 */

import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Shield,
  Network,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { configEditorApi } from '@/lib/configEditorApi'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { SafetyToggle } from '@/components/config/SafetyToggle'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import type { ConfigPanelProps, ConfigChange } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubTab = 'filter' | 'nat'

type FilterAction = 'accept' | 'drop' | 'reject' | 'log' | 'jump' | 'passthrough'
type FilterChain = 'input' | 'forward' | 'output'
type NatChain = 'srcnat' | 'dstnat'
type NatAction = 'masquerade' | 'dst-nat' | 'src-nat' | 'redirect' | 'netmap'
type Protocol = 'tcp' | 'udp' | 'icmp' | ''

interface FilterFormData {
  chain: FilterChain
  action: FilterAction
  protocol: Protocol
  'src-address': string
  'dst-address': string
  'src-port': string
  'dst-port': string
  'in-interface': string
  'out-interface': string
  comment: string
  disabled: boolean
}

interface NatFormData {
  chain: NatChain
  action: NatAction
  protocol: Protocol
  'src-address': string
  'dst-address': string
  'src-port': string
  'dst-port': string
  'to-addresses': string
  'to-ports': string
  comment: string
  disabled: boolean
}

type FormMode = 'add' | 'edit'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTER_PATH = '/ip/firewall/filter'
const NAT_PATH = '/ip/firewall/nat'

const FILTER_CHAINS: FilterChain[] = ['input', 'forward', 'output']
const FILTER_ACTIONS: FilterAction[] = ['accept', 'drop', 'reject', 'log', 'jump', 'passthrough']
const NAT_CHAINS: NatChain[] = ['srcnat', 'dstnat']
const NAT_ACTIONS: NatAction[] = ['masquerade', 'dst-nat', 'src-nat', 'redirect', 'netmap']
const PROTOCOLS: Protocol[] = ['tcp', 'udp', 'icmp', '']

const DEFAULT_FILTER_FORM: FilterFormData = {
  chain: 'input',
  action: 'accept',
  protocol: '',
  'src-address': '',
  'dst-address': '',
  'src-port': '',
  'dst-port': '',
  'in-interface': '',
  'out-interface': '',
  comment: '',
  disabled: false,
}

const DEFAULT_NAT_FORM: NatFormData = {
  chain: 'srcnat',
  action: 'masquerade',
  protocol: '',
  'src-address': '',
  'dst-address': '',
  'src-port': '',
  'dst-port': '',
  'to-addresses': '',
  'to-ports': '',
  comment: '',
  disabled: false,
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function getFilterActionColor(action: string): string {
  switch (action) {
    case 'accept':
      return 'border-l-4 border-l-success/60'
    case 'drop':
      return 'border-l-4 border-l-error/60'
    case 'reject':
      return 'border-l-4 border-l-warning/60'
    case 'log':
      return 'border-l-4 border-l-info/60'
    default:
      return 'border-l-4 border-l-border'
  }
}

function getNatActionColor(action: string): string {
  switch (action) {
    case 'masquerade':
      return 'border-l-4 border-l-success/60'
    case 'dst-nat':
      return 'border-l-4 border-l-info/60'
    case 'src-nat':
      return 'border-l-4 border-l-warning/60'
    default:
      return 'border-l-4 border-l-border'
  }
}

function getActionBadgeClasses(action: string): string {
  switch (action) {
    case 'accept':
    case 'masquerade':
      return 'bg-success/15 text-success border-success/30'
    case 'drop':
      return 'bg-error/15 text-error border-error/30'
    case 'reject':
      return 'bg-warning/15 text-warning border-warning/30'
    case 'log':
    case 'dst-nat':
      return 'bg-info/15 text-info border-info/30'
    case 'src-nat':
    case 'redirect':
      return 'bg-warning/15 text-warning border-warning/30'
    default:
      return 'bg-elevated text-text-secondary border-border'
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const IP_CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
const PORT_RANGE_REGEX = /^\d{1,5}(-\d{1,5})?$/

function validateIpCidr(value: string): string | null {
  if (!value) return null
  if (!IP_CIDR_REGEX.test(value)) {
    return 'Invalid IP address or CIDR notation (e.g., 192.168.1.0/24)'
  }
  const parts = value.split('/')[0].split('.')
  if (parts.some((p) => parseInt(p, 10) > 255)) {
    return 'IP octets must be 0-255'
  }
  const cidr = value.split('/')[1]
  if (cidr && (parseInt(cidr, 10) < 0 || parseInt(cidr, 10) > 32)) {
    return 'CIDR prefix must be 0-32'
  }
  return null
}

function validatePort(value: string): string | null {
  if (!value) return null
  if (!PORT_RANGE_REGEX.test(value)) {
    return 'Invalid port (number or range e.g., 80 or 1024-65535)'
  }
  const parts = value.split('-').map((p) => parseInt(p, 10))
  if (parts.some((p) => p < 0 || p > 65535)) {
    return 'Port must be 0-65535'
  }
  if (parts.length === 2 && parts[0] > parts[1]) {
    return 'Start port must be less than end port'
  }
  return null
}

// ---------------------------------------------------------------------------
// FirewallPanel
// ---------------------------------------------------------------------------

export function FirewallPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>('filter')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Data loading
  const filterQuery = useConfigBrowse(tenantId, deviceId, FILTER_PATH, { enabled: active })
  const natQuery = useConfigBrowse(tenantId, deviceId, NAT_PATH, { enabled: active })

  // Config panel (change management + apply)
  const panel = useConfigPanel(tenantId, deviceId, 'firewall')

  // Filter rule form state
  const [filterFormOpen, setFilterFormOpen] = useState(false)
  const [filterFormMode, setFilterFormMode] = useState<FormMode>('add')
  const [filterFormData, setFilterFormData] = useState<FilterFormData>(DEFAULT_FILTER_FORM)
  const [filterEditId, setFilterEditId] = useState<string | null>(null)

  // NAT rule form state
  const [natFormOpen, setNatFormOpen] = useState(false)
  const [natFormMode, setNatFormMode] = useState<FormMode>('add')
  const [natFormData, setNatFormData] = useState<NatFormData>(DEFAULT_NAT_FORM)
  const [natEditId, setNatEditId] = useState<string | null>(null)

  // Move in progress
  const [movingId, setMovingId] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Filter rule handlers
  // -------------------------------------------------------------------------

  const openAddFilter = useCallback(() => {
    setFilterFormMode('add')
    setFilterFormData(DEFAULT_FILTER_FORM)
    setFilterEditId(null)
    setFilterFormOpen(true)
  }, [])

  const openEditFilter = useCallback((entry: Record<string, string>) => {
    setFilterFormMode('edit')
    setFilterFormData({
      chain: (entry.chain || 'input') as FilterChain,
      action: (entry.action || 'accept') as FilterAction,
      protocol: (entry.protocol || '') as Protocol,
      'src-address': entry['src-address'] || '',
      'dst-address': entry['dst-address'] || '',
      'src-port': entry['src-port'] || '',
      'dst-port': entry['dst-port'] || '',
      'in-interface': entry['in-interface'] || '',
      'out-interface': entry['out-interface'] || '',
      comment: entry.comment || '',
      disabled: entry.disabled === 'true',
    })
    setFilterEditId(entry['.id'] || null)
    setFilterFormOpen(true)
  }, [])

  const submitFilterForm = useCallback(() => {
    // Validate
    const srcErr = validateIpCidr(filterFormData['src-address'])
    const dstErr = validateIpCidr(filterFormData['dst-address'])
    const srcPortErr = validatePort(filterFormData['src-port'])
    const dstPortErr = validatePort(filterFormData['dst-port'])
    const errors = [srcErr, dstErr, srcPortErr, dstPortErr].filter(Boolean)
    if (errors.length > 0) {
      toast.error('Validation error', { description: errors[0]! })
      return
    }

    // Build properties (only include non-empty values)
    const props: Record<string, string> = {}
    props.chain = filterFormData.chain
    props.action = filterFormData.action
    if (filterFormData.protocol) props.protocol = filterFormData.protocol
    if (filterFormData['src-address']) props['src-address'] = filterFormData['src-address']
    if (filterFormData['dst-address']) props['dst-address'] = filterFormData['dst-address']
    if (filterFormData['src-port']) props['src-port'] = filterFormData['src-port']
    if (filterFormData['dst-port']) props['dst-port'] = filterFormData['dst-port']
    if (filterFormData['in-interface']) props['in-interface'] = filterFormData['in-interface']
    if (filterFormData['out-interface']) props['out-interface'] = filterFormData['out-interface']
    if (filterFormData.comment) props.comment = filterFormData.comment
    if (filterFormData.disabled) props.disabled = 'true'

    const change: ConfigChange = {
      operation: filterFormMode === 'add' ? 'add' : 'set',
      path: FILTER_PATH,
      entryId: filterFormMode === 'edit' ? filterEditId ?? undefined : undefined,
      properties: props,
      description:
        filterFormMode === 'add'
          ? `Add ${filterFormData.action} rule on ${filterFormData.chain} chain`
          : `Edit filter rule ${filterEditId ?? ''}`,
    }

    panel.addChange(change)
    setFilterFormOpen(false)
    toast.success(`Filter rule ${filterFormMode === 'add' ? 'added' : 'updated'} in pending changes`)
  }, [filterFormData, filterFormMode, filterEditId, panel])

  // -------------------------------------------------------------------------
  // NAT rule handlers
  // -------------------------------------------------------------------------

  const openAddNat = useCallback(() => {
    setNatFormMode('add')
    setNatFormData(DEFAULT_NAT_FORM)
    setNatEditId(null)
    setNatFormOpen(true)
  }, [])

  const openEditNat = useCallback((entry: Record<string, string>) => {
    setNatFormMode('edit')
    setNatFormData({
      chain: (entry.chain || 'srcnat') as NatChain,
      action: (entry.action || 'masquerade') as NatAction,
      protocol: (entry.protocol || '') as Protocol,
      'src-address': entry['src-address'] || '',
      'dst-address': entry['dst-address'] || '',
      'src-port': entry['src-port'] || '',
      'dst-port': entry['dst-port'] || '',
      'to-addresses': entry['to-addresses'] || '',
      'to-ports': entry['to-ports'] || '',
      comment: entry.comment || '',
      disabled: entry.disabled === 'true',
    })
    setNatEditId(entry['.id'] || null)
    setNatFormOpen(true)
  }, [])

  const submitNatForm = useCallback(() => {
    // Validate
    const srcErr = validateIpCidr(natFormData['src-address'])
    const dstErr = validateIpCidr(natFormData['dst-address'])
    const srcPortErr = validatePort(natFormData['src-port'])
    const dstPortErr = validatePort(natFormData['dst-port'])
    const errors = [srcErr, dstErr, srcPortErr, dstPortErr].filter(Boolean)
    if (errors.length > 0) {
      toast.error('Validation error', { description: errors[0]! })
      return
    }

    const props: Record<string, string> = {}
    props.chain = natFormData.chain
    props.action = natFormData.action
    if (natFormData.protocol) props.protocol = natFormData.protocol
    if (natFormData['src-address']) props['src-address'] = natFormData['src-address']
    if (natFormData['dst-address']) props['dst-address'] = natFormData['dst-address']
    if (natFormData['src-port']) props['src-port'] = natFormData['src-port']
    if (natFormData['dst-port']) props['dst-port'] = natFormData['dst-port']
    if (natFormData['to-addresses']) props['to-addresses'] = natFormData['to-addresses']
    if (natFormData['to-ports']) props['to-ports'] = natFormData['to-ports']
    if (natFormData.comment) props.comment = natFormData.comment
    if (natFormData.disabled) props.disabled = 'true'

    const change: ConfigChange = {
      operation: natFormMode === 'add' ? 'add' : 'set',
      path: NAT_PATH,
      entryId: natFormMode === 'edit' ? natEditId ?? undefined : undefined,
      properties: props,
      description:
        natFormMode === 'add'
          ? `Add ${natFormData.action} NAT rule on ${natFormData.chain} chain`
          : `Edit NAT rule ${natEditId ?? ''}`,
    }

    panel.addChange(change)
    setNatFormOpen(false)
    toast.success(`NAT rule ${natFormMode === 'add' ? 'added' : 'updated'} in pending changes`)
  }, [natFormData, natFormMode, natEditId, panel])

  // -------------------------------------------------------------------------
  // Shared rule actions
  // -------------------------------------------------------------------------

  const handleToggleDisable = useCallback(
    (entry: Record<string, string>, path: string) => {
      const isDisabled = entry.disabled === 'true'
      const change: ConfigChange = {
        operation: 'set',
        path,
        entryId: entry['.id'],
        properties: { disabled: isDisabled ? 'false' : 'true' },
        description: `${isDisabled ? 'Enable' : 'Disable'} rule ${entry['.id'] ?? ''}`,
      }
      panel.addChange(change)
      toast.success(`Rule ${isDisabled ? 'enable' : 'disable'} added to pending changes`)
    },
    [panel],
  )

  const handleDeleteRule = useCallback(
    (entry: Record<string, string>, path: string) => {
      const change: ConfigChange = {
        operation: 'remove',
        path,
        entryId: entry['.id'],
        properties: {},
        description: `Delete rule ${entry['.id'] ?? ''} (${entry.action || 'unknown'} on ${entry.chain || 'unknown'})`,
      }
      panel.addChange(change)
      toast.success('Rule deletion added to pending changes')
    },
    [panel],
  )

  const handleMoveRule = useCallback(
    async (entry: Record<string, string>, index: number, direction: 'up' | 'down') => {
      const ruleId = entry['.id']
      if (!ruleId) return
      const destination = direction === 'up' ? index - 1 : index + 1
      if (destination < 0) return

      setMovingId(ruleId)
      try {
        const command = `${FILTER_PATH}/move .id=${ruleId} destination=${destination}`
        const result = await configEditorApi.execute(tenantId, deviceId, command)
        if (!result.success) {
          throw new Error(result.error ?? 'Move failed')
        }
        toast.success(`Rule moved ${direction}`)
        filterQuery.refetch()
      } catch (err) {
        toast.error('Failed to move rule', {
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        setMovingId(null)
      }
    },
    [tenantId, deviceId, filterQuery],
  )

  // -------------------------------------------------------------------------
  // Apply flow
  // -------------------------------------------------------------------------

  const handleApply = useCallback(() => {
    panel.applyChanges()
    setPreviewOpen(false)
  }, [panel])

  const afterApply = useMemo(() => {
    // When applyChanges succeeds, the hook auto-refetches via queryClient.invalidateQueries
    return panel.pendingChanges.length
  }, [panel.pendingChanges.length])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Sub-tabs */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubTab('filter')}
            className={cn(
              'gap-1.5',
              subTab === 'filter' &&
                'bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:text-accent',
            )}
          >
            <Shield className="h-3.5 w-3.5" />
            Filter Rules
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubTab('nat')}
            className={cn(
              'gap-1.5',
              subTab === 'nat' &&
                'bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:text-accent',
            )}
          >
            <Network className="h-3.5 w-3.5" />
            NAT Rules
          </Button>
        </div>

        {/* Safety toggle + apply */}
        <div className="flex items-center gap-3">
          <SafetyToggle mode={panel.applyMode} onModeChange={panel.setApplyMode} />
          <Button
            size="sm"
            disabled={panel.pendingChanges.length === 0 || panel.isApplying}
            onClick={() => setPreviewOpen(true)}
          >
            Review & Apply
            {panel.pendingChanges.length > 0 && (
              <Badge className="ml-1.5 bg-accent/20 text-accent border-accent/40 text-xs px-1.5">
                {panel.pendingChanges.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Tables */}
      {subTab === 'filter' ? (
        <FilterRulesTable
          entries={filterQuery.entries}
          isLoading={filterQuery.isLoading}
          error={filterQuery.error}
          onRetry={filterQuery.refetch}
          onAdd={openAddFilter}
          onEdit={openEditFilter}
          onToggleDisable={(e) => handleToggleDisable(e, FILTER_PATH)}
          onDelete={(e) => handleDeleteRule(e, FILTER_PATH)}
          onMoveUp={(e, i) => handleMoveRule(e, i, 'up')}
          onMoveDown={(e, i) => handleMoveRule(e, i, 'down')}
          movingId={movingId}
        />
      ) : (
        <NatRulesTable
          entries={natQuery.entries}
          isLoading={natQuery.isLoading}
          error={natQuery.error}
          onRetry={natQuery.refetch}
          onAdd={openAddNat}
          onEdit={openEditNat}
          onToggleDisable={(e) => handleToggleDisable(e, NAT_PATH)}
          onDelete={(e) => handleDeleteRule(e, NAT_PATH)}
        />
      )}

      {/* Filter Rule Builder Dialog */}
      <FilterRuleDialog
        open={filterFormOpen}
        onOpenChange={setFilterFormOpen}
        mode={filterFormMode}
        data={filterFormData}
        onChange={setFilterFormData}
        onSubmit={submitFilterForm}
      />

      {/* NAT Rule Builder Dialog */}
      <NatRuleDialog
        open={natFormOpen}
        onOpenChange={setNatFormOpen}
        mode={natFormMode}
        data={natFormData}
        onChange={setNatFormData}
        onSubmit={submitNatForm}
      />

      {/* Change Preview Modal */}
      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={handleApply}
        isApplying={panel.isApplying}
      />
    </div>
  )
}

// ===========================================================================
// Filter Rules Table
// ===========================================================================

interface FilterRulesTableProps {
  entries: Record<string, string>[]
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  onAdd: () => void
  onEdit: (entry: Record<string, string>) => void
  onToggleDisable: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
  onMoveUp: (entry: Record<string, string>, index: number) => void
  onMoveDown: (entry: Record<string, string>, index: number) => void
  movingId: string | null
}

function FilterRulesTable({
  entries,
  isLoading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onToggleDisable,
  onDelete,
  onMoveUp,
  onMoveDown,
  movingId,
}: FilterRulesTableProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/5 p-4 space-y-2">
        <p className="text-sm text-error">
          Failed to load filter rules: {error.message}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry} className="text-xs">
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">
          Filter Rules ({isLoading ? '...' : entries.length})
        </h3>
        <Button size="sm" variant="outline" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Rule
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-elevated text-text-muted text-xs uppercase">
                <th className="px-3 py-2 text-left font-medium w-10">#</th>
                <th className="px-3 py-2 text-left font-medium">Chain</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Src Address</th>
                <th className="px-3 py-2 text-left font-medium">Dst Address</th>
                <th className="px-3 py-2 text-left font-medium">Protocol</th>
                <th className="px-3 py-2 text-left font-medium">Dst Port</th>
                <th className="px-3 py-2 text-left font-medium">In Iface</th>
                <th className="px-3 py-2 text-left font-medium">Out Iface</th>
                <th className="px-3 py-2 text-left font-medium">Comment</th>
                <th className="px-3 py-2 text-left font-medium w-10">Dis</th>
                <th className="px-3 py-2 text-right font-medium w-12" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={12} />
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-text-muted text-sm">
                    No filter rules configured
                  </td>
                </tr>
              ) : (
                entries.map((entry, index) => {
                  const isDisabled = entry.disabled === 'true'
                  const isMoving = movingId === entry['.id']
                  return (
                    <tr
                      key={entry['.id'] || index}
                      className={cn(
                        'border-b border-border/50 hover:bg-elevated/50 transition-colors',
                        getFilterActionColor(entry.action),
                        isDisabled && 'opacity-50',
                        isMoving && 'opacity-70',
                      )}
                    >
                      <td className="px-3 py-2 text-text-muted font-mono text-xs">{index + 1}</td>
                      <td className="px-3 py-2">{entry.chain || <CellEmpty />}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs font-medium',
                            getActionBadgeClasses(entry.action),
                            isDisabled && 'line-through',
                          )}
                        >
                          {entry.action || 'unknown'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['src-address'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['dst-address'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2">{entry.protocol || <CellEmpty />}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['dst-port'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {entry['in-interface'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {entry['out-interface'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary max-w-[160px] truncate">
                        {entry.comment || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDisabled ? (
                          <EyeOff className="h-3.5 w-3.5 text-warning inline" />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(entry)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onToggleDisable(entry)}>
                              {isDisabled ? (
                                <>
                                  <Eye className="h-3.5 w-3.5 mr-2" />
                                  Enable
                                </>
                              ) : (
                                <>
                                  <EyeOff className="h-3.5 w-3.5 mr-2" />
                                  Disable
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onMoveUp(entry, index)}
                              disabled={index === 0 || isMoving}
                            >
                              <ArrowUp className="h-3.5 w-3.5 mr-2" />
                              Move Up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onMoveDown(entry, index)}
                              disabled={index === entries.length - 1 || isMoving}
                            >
                              <ArrowDown className="h-3.5 w-3.5 mr-2" />
                              Move Down
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onDelete(entry)}
                              className="text-error focus:text-error"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// NAT Rules Table
// ===========================================================================

interface NatRulesTableProps {
  entries: Record<string, string>[]
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  onAdd: () => void
  onEdit: (entry: Record<string, string>) => void
  onToggleDisable: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
}

function NatRulesTable({
  entries,
  isLoading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onToggleDisable,
  onDelete,
}: NatRulesTableProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/5 p-4 space-y-2">
        <p className="text-sm text-error">
          Failed to load NAT rules: {error.message}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry} className="text-xs">
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">
          NAT Rules ({isLoading ? '...' : entries.length})
        </h3>
        <Button size="sm" variant="outline" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add NAT Rule
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-elevated text-text-muted text-xs uppercase">
                <th className="px-3 py-2 text-left font-medium w-10">#</th>
                <th className="px-3 py-2 text-left font-medium">Chain</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Src Address</th>
                <th className="px-3 py-2 text-left font-medium">Dst Address</th>
                <th className="px-3 py-2 text-left font-medium">Protocol</th>
                <th className="px-3 py-2 text-left font-medium">Dst Port</th>
                <th className="px-3 py-2 text-left font-medium">To Addresses</th>
                <th className="px-3 py-2 text-left font-medium">To Ports</th>
                <th className="px-3 py-2 text-left font-medium">Comment</th>
                <th className="px-3 py-2 text-left font-medium w-10">Dis</th>
                <th className="px-3 py-2 text-right font-medium w-12" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={12} />
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-text-muted text-sm">
                    No NAT rules configured
                  </td>
                </tr>
              ) : (
                entries.map((entry, index) => {
                  const isDisabled = entry.disabled === 'true'
                  return (
                    <tr
                      key={entry['.id'] || index}
                      className={cn(
                        'border-b border-border/50 hover:bg-elevated/50 transition-colors',
                        getNatActionColor(entry.action),
                        isDisabled && 'opacity-50',
                      )}
                    >
                      <td className="px-3 py-2 text-text-muted font-mono text-xs">{index + 1}</td>
                      <td className="px-3 py-2">{entry.chain || <CellEmpty />}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs font-medium',
                            getActionBadgeClasses(entry.action),
                            isDisabled && 'line-through',
                          )}
                        >
                          {entry.action || 'unknown'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['src-address'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['dst-address'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2">{entry.protocol || <CellEmpty />}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['dst-port'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['to-addresses'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {entry['to-ports'] || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary max-w-[160px] truncate">
                        {entry.comment || <CellEmpty />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDisabled ? (
                          <EyeOff className="h-3.5 w-3.5 text-warning inline" />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(entry)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onToggleDisable(entry)}>
                              {isDisabled ? (
                                <>
                                  <Eye className="h-3.5 w-3.5 mr-2" />
                                  Enable
                                </>
                              ) : (
                                <>
                                  <EyeOff className="h-3.5 w-3.5 mr-2" />
                                  Disable
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onDelete(entry)}
                              className="text-error focus:text-error"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// Filter Rule Dialog (Visual Builder)
// ===========================================================================

interface FilterRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: FormMode
  data: FilterFormData
  onChange: (data: FilterFormData) => void
  onSubmit: () => void
}

function FilterRuleDialog({
  open,
  onOpenChange,
  mode,
  data,
  onChange,
  onSubmit,
}: FilterRuleDialogProps) {
  const updateField = <K extends keyof FilterFormData>(key: K, value: FilterFormData[K]) => {
    onChange({ ...data, [key]: value })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add Filter Rule' : 'Edit Filter Rule'}</DialogTitle>
          <DialogDescription>
            Configure firewall filter rule properties. Only non-empty fields will be applied.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          {/* Chain */}
          <div className="space-y-1.5">
            <Label>Chain *</Label>
            <Select value={data.chain} onValueChange={(v) => updateField('chain', v as FilterChain)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_CHAINS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action */}
          <div className="space-y-1.5">
            <Label>Action *</Label>
            <Select value={data.action} onValueChange={(v) => updateField('action', v as FilterAction)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Protocol */}
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={data.protocol || '_any'} onValueChange={(v) => updateField('protocol', (v === '_any' ? '' : v) as Protocol)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_any">any</SelectItem>
                {PROTOCOLS.filter(Boolean).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Src Address */}
          <div className="space-y-1.5">
            <Label>Src Address</Label>
            <Input
              placeholder="e.g., 192.168.1.0/24"
              value={data['src-address']}
              onChange={(e) => updateField('src-address', e.target.value)}
            />
          </div>

          {/* Dst Address */}
          <div className="space-y-1.5">
            <Label>Dst Address</Label>
            <Input
              placeholder="e.g., 10.0.0.0/8"
              value={data['dst-address']}
              onChange={(e) => updateField('dst-address', e.target.value)}
            />
          </div>

          {/* Src Port */}
          <div className="space-y-1.5">
            <Label>Src Port</Label>
            <Input
              placeholder="e.g., 1024-65535"
              value={data['src-port']}
              onChange={(e) => updateField('src-port', e.target.value)}
            />
          </div>

          {/* Dst Port */}
          <div className="space-y-1.5">
            <Label>Dst Port</Label>
            <Input
              placeholder="e.g., 80 or 443"
              value={data['dst-port']}
              onChange={(e) => updateField('dst-port', e.target.value)}
            />
          </div>

          {/* In Interface */}
          <div className="space-y-1.5">
            <Label>In Interface</Label>
            <Input
              placeholder="e.g., ether1"
              value={data['in-interface']}
              onChange={(e) => updateField('in-interface', e.target.value)}
            />
          </div>

          {/* Out Interface */}
          <div className="space-y-1.5">
            <Label>Out Interface</Label>
            <Input
              placeholder="e.g., ether2"
              value={data['out-interface']}
              onChange={(e) => updateField('out-interface', e.target.value)}
            />
          </div>

          {/* Comment */}
          <div className="col-span-2 space-y-1.5">
            <Label>Comment</Label>
            <Input
              placeholder="Rule description (optional)"
              value={data.comment}
              onChange={(e) => updateField('comment', e.target.value)}
            />
          </div>

          {/* Disabled */}
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox
              id="filter-disabled"
              checked={data.disabled}
              onCheckedChange={(checked) => updateField('disabled', checked === true)}
            />
            <Label htmlFor="filter-disabled" className="cursor-pointer">
              Create rule in disabled state
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>
            {mode === 'add' ? 'Add to Changes' : 'Update in Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// NAT Rule Dialog (Visual Builder)
// ===========================================================================

interface NatRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: FormMode
  data: NatFormData
  onChange: (data: NatFormData) => void
  onSubmit: () => void
}

function NatRuleDialog({
  open,
  onOpenChange,
  mode,
  data,
  onChange,
  onSubmit,
}: NatRuleDialogProps) {
  const updateField = <K extends keyof NatFormData>(key: K, value: NatFormData[K]) => {
    onChange({ ...data, [key]: value })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add NAT Rule' : 'Edit NAT Rule'}</DialogTitle>
          <DialogDescription>
            Configure NAT rule properties. Only non-empty fields will be applied.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          {/* Chain */}
          <div className="space-y-1.5">
            <Label>Chain *</Label>
            <Select value={data.chain} onValueChange={(v) => updateField('chain', v as NatChain)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NAT_CHAINS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action */}
          <div className="space-y-1.5">
            <Label>Action *</Label>
            <Select value={data.action} onValueChange={(v) => updateField('action', v as NatAction)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NAT_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Protocol */}
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={data.protocol || '_any'} onValueChange={(v) => updateField('protocol', (v === '_any' ? '' : v) as Protocol)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_any">any</SelectItem>
                {PROTOCOLS.filter(Boolean).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Src Address */}
          <div className="space-y-1.5">
            <Label>Src Address</Label>
            <Input
              placeholder="e.g., 192.168.1.0/24"
              value={data['src-address']}
              onChange={(e) => updateField('src-address', e.target.value)}
            />
          </div>

          {/* Dst Address */}
          <div className="space-y-1.5">
            <Label>Dst Address</Label>
            <Input
              placeholder="e.g., 10.0.0.0/8"
              value={data['dst-address']}
              onChange={(e) => updateField('dst-address', e.target.value)}
            />
          </div>

          {/* Src Port */}
          <div className="space-y-1.5">
            <Label>Src Port</Label>
            <Input
              placeholder="e.g., 1024-65535"
              value={data['src-port']}
              onChange={(e) => updateField('src-port', e.target.value)}
            />
          </div>

          {/* Dst Port */}
          <div className="space-y-1.5">
            <Label>Dst Port</Label>
            <Input
              placeholder="e.g., 80 or 443"
              value={data['dst-port']}
              onChange={(e) => updateField('dst-port', e.target.value)}
            />
          </div>

          {/* To Addresses */}
          <div className="space-y-1.5">
            <Label>To Addresses</Label>
            <Input
              placeholder="e.g., 192.168.1.100"
              value={data['to-addresses']}
              onChange={(e) => updateField('to-addresses', e.target.value)}
            />
          </div>

          {/* To Ports */}
          <div className="space-y-1.5">
            <Label>To Ports</Label>
            <Input
              placeholder="e.g., 8080"
              value={data['to-ports']}
              onChange={(e) => updateField('to-ports', e.target.value)}
            />
          </div>

          {/* Comment */}
          <div className="col-span-2 space-y-1.5">
            <Label>Comment</Label>
            <Input
              placeholder="Rule description (optional)"
              value={data.comment}
              onChange={(e) => updateField('comment', e.target.value)}
            />
          </div>

          {/* Disabled */}
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox
              id="nat-disabled"
              checked={data.disabled}
              onCheckedChange={(checked) => updateField('disabled', checked === true)}
            />
            <Label htmlFor="nat-disabled" className="cursor-pointer">
              Create rule in disabled state
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>
            {mode === 'add' ? 'Add to Changes' : 'Update in Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Shared sub-components
// ===========================================================================

function CellEmpty() {
  return <span className="text-text-muted">&mdash;</span>
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-border/50">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-3 py-2">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
