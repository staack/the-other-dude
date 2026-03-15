/**
 * QueuesPanel -- Queue/bandwidth management with simple queues and queue trees.
 *
 * Simple Queues: /queue/simple -- name, target, max-limit (upload/download), burst, priority
 * Queue Trees: /queue/tree -- parent-child hierarchy with packet marks
 *
 * Bandwidth values displayed in human-readable format (10M -> 10 Mbps).
 */

import { useState, useMemo, useCallback } from 'react'
import {
  Gauge,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  ArrowUp,
  ArrowDown,
  GitBranch,
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
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { SafetyToggle } from '@/components/config/SafetyToggle'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubTab = 'simple' | 'tree'

interface SimpleQueueFormData {
  name: string
  target: string
  'max-limit-upload': string
  'max-limit-download': string
  'burst-limit-upload': string
  'burst-limit-download': string
  'burst-threshold-upload': string
  'burst-threshold-download': string
  'burst-time': string
  priority: string
  disabled: string
}

interface QueueTreeFormData {
  name: string
  parent: string
  'packet-mark': string
  queue: string
  priority: string
  'max-limit': string
}

interface TreeNode {
  entry: Record<string, string>
  children: TreeNode[]
  depth: number
}

// ---------------------------------------------------------------------------
// Bandwidth Parsing Helpers
// ---------------------------------------------------------------------------

/** Parse RouterOS bandwidth string to human-readable format */
function formatBandwidth(bw: string): string {
  if (!bw || bw === '0') return '0'
  const upper = bw.toUpperCase()
  if (upper.endsWith('G')) return `${bw.slice(0, -1)} Gbps`
  if (upper.endsWith('M')) return `${bw.slice(0, -1)} Mbps`
  if (upper.endsWith('K')) return `${bw.slice(0, -1)} Kbps`
  // Assume raw number is bps
  const num = parseInt(bw, 10)
  if (isNaN(num)) return bw
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)} Gbps`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)} Mbps`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)} Kbps`
  return `${num} bps`
}

/** Parse max-limit "upload/download" format into parts */
function parseMaxLimit(maxLimit: string): { upload: string; download: string } {
  if (!maxLimit) return { upload: '0', download: '0' }
  const parts = maxLimit.split('/')
  return {
    upload: parts[0] || '0',
    download: parts[1] || parts[0] || '0',
  }
}

/** Parse bandwidth string to numeric bytes for progress bar calculation */
function bandwidthToBytes(bw: string): number {
  if (!bw || bw === '0') return 0
  const upper = bw.toUpperCase().trim()
  const num = parseFloat(upper)
  if (isNaN(num)) return 0
  if (upper.endsWith('G')) return num * 1_000_000_000
  if (upper.endsWith('M')) return num * 1_000_000
  if (upper.endsWith('K')) return num * 1_000
  return num
}

/** Priority badge color: 1=highest(red-ish) to 8=lowest(muted) */
function priorityColor(priority: string): string {
  const p = parseInt(priority, 10) || 8
  if (p <= 2) return 'bg-error/20 text-error border-error/40'
  if (p <= 4) return 'bg-warning/20 text-warning border-warning/40'
  if (p <= 6) return 'bg-accent/20 text-accent border-accent/40'
  return 'bg-elevated text-text-muted border-border'
}

// ---------------------------------------------------------------------------
// Tree Builder
// ---------------------------------------------------------------------------

function buildTree(entries: Record<string, string>[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes
  for (const entry of entries) {
    nodeMap.set(entry.name, { entry, children: [], depth: 0 })
  }

  // Build hierarchy
  for (const entry of entries) {
    const node = nodeMap.get(entry.name)!
    const parentName = entry.parent
    if (parentName && parentName !== 'global' && nodeMap.has(parentName)) {
      const parentNode = nodeMap.get(parentName)!
      parentNode.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Set depths
  function setDepth(node: TreeNode, depth: number) {
    node.depth = depth
    for (const child of node.children) {
      setDepth(child, depth + 1)
    }
  }
  for (const root of roots) {
    setDepth(root, 0)
  }

  return roots
}

/** Flatten tree for rendering */
function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  function walk(node: TreeNode) {
    result.push(node)
    for (const child of node.children) {
      walk(child)
    }
  }
  for (const n of nodes) walk(n)
  return result
}

// ---------------------------------------------------------------------------
// QueuesPanel Component
// ---------------------------------------------------------------------------

export function QueuesPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>('simple')
  const [simpleDialogOpen, setSimpleDialogOpen] = useState(false)
  const [editingSimple, setEditingSimple] = useState<Record<string, string> | null>(null)
  const [treeDialogOpen, setTreeDialogOpen] = useState(false)
  const [editingTree, setEditingTree] = useState<Record<string, string> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Data loading
  const { entries: simpleQueues, isLoading: loadingSimple, error: simpleError } = useConfigBrowse(
    tenantId, deviceId, '/queue/simple', { enabled: active },
  )
  const { entries: treeQueues, isLoading: loadingTree, error: treeError } = useConfigBrowse(
    tenantId, deviceId, '/queue/tree', { enabled: active },
  )

  // Config panel state
  const {
    pendingChanges, applyMode, setApplyMode,
    addChange, clearChanges, applyChanges, isApplying,
  } = useConfigPanel(tenantId, deviceId, 'queues')

  // Compute max bandwidth for progress bar baseline
  const maxBandwidth = useMemo(() => {
    let max = 100_000_000 // 100M default baseline
    for (const q of simpleQueues) {
      const { upload, download } = parseMaxLimit(q['max-limit'] || '')
      max = Math.max(max, bandwidthToBytes(upload), bandwidthToBytes(download))
    }
    return max
  }, [simpleQueues])

  // Tree structure
  const treeNodes = useMemo(() => buildTree(treeQueues), [treeQueues])
  const flatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes])

  // ---------------------------------------------------------------------------
  // Simple Queue Handlers
  // ---------------------------------------------------------------------------

  const handleAddSimple = useCallback(() => {
    setEditingSimple(null)
    setSimpleDialogOpen(true)
  }, [])

  const handleEditSimple = useCallback((entry: Record<string, string>) => {
    setEditingSimple(entry)
    setSimpleDialogOpen(true)
  }, [])

  const handleToggleSimple = useCallback((entry: Record<string, string>) => {
    const isDisabled = entry.disabled === 'true' || entry.disabled === 'yes'
    addChange({
      operation: 'set',
      path: '/queue/simple',
      entryId: entry['.id'],
      properties: { disabled: isDisabled ? 'no' : 'yes' },
      description: `${isDisabled ? 'Enable' : 'Disable'} simple queue "${entry.name}"`,
    })
  }, [addChange])

  const handleDeleteSimple = useCallback((entry: Record<string, string>) => {
    addChange({
      operation: 'remove',
      path: '/queue/simple',
      entryId: entry['.id'],
      properties: {},
      description: `Remove simple queue "${entry.name}"`,
    })
  }, [addChange])

  const handleSaveSimple = useCallback((formData: SimpleQueueFormData) => {
    const maxLimit = `${formData['max-limit-upload'] || '0'}/${formData['max-limit-download'] || '0'}`
    const properties: Record<string, string> = {
      name: formData.name,
      target: formData.target,
      'max-limit': maxLimit,
      priority: formData.priority || '8',
      disabled: formData.disabled,
    }
    // Optional burst fields
    if (formData['burst-limit-upload'] || formData['burst-limit-download']) {
      properties['burst-limit'] = `${formData['burst-limit-upload'] || '0'}/${formData['burst-limit-download'] || '0'}`
    }
    if (formData['burst-threshold-upload'] || formData['burst-threshold-download']) {
      properties['burst-threshold'] = `${formData['burst-threshold-upload'] || '0'}/${formData['burst-threshold-download'] || '0'}`
    }
    if (formData['burst-time']) {
      properties['burst-time'] = formData['burst-time']
    }

    if (editingSimple) {
      addChange({
        operation: 'set',
        path: '/queue/simple',
        entryId: editingSimple['.id'],
        properties,
        description: `Update simple queue "${formData.name}" (limit: ${maxLimit})`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/queue/simple',
        properties,
        description: `Add simple queue "${formData.name}" (limit: ${maxLimit})`,
      })
    }
    setSimpleDialogOpen(false)
    setEditingSimple(null)
  }, [editingSimple, addChange])

  // ---------------------------------------------------------------------------
  // Queue Tree Handlers
  // ---------------------------------------------------------------------------

  const handleAddTree = useCallback(() => {
    setEditingTree(null)
    setTreeDialogOpen(true)
  }, [])

  const handleEditTree = useCallback((entry: Record<string, string>) => {
    setEditingTree(entry)
    setTreeDialogOpen(true)
  }, [])

  const handleDeleteTree = useCallback((entry: Record<string, string>) => {
    addChange({
      operation: 'remove',
      path: '/queue/tree',
      entryId: entry['.id'],
      properties: {},
      description: `Remove queue tree entry "${entry.name}"`,
    })
  }, [addChange])

  const handleSaveTree = useCallback((formData: QueueTreeFormData) => {
    const properties: Record<string, string> = {
      name: formData.name,
      parent: formData.parent || 'global',
      priority: formData.priority || '8',
    }
    if (formData['packet-mark']) properties['packet-mark'] = formData['packet-mark']
    if (formData.queue) properties.queue = formData.queue
    if (formData['max-limit']) properties['max-limit'] = formData['max-limit']

    if (editingTree) {
      addChange({
        operation: 'set',
        path: '/queue/tree',
        entryId: editingTree['.id'],
        properties,
        description: `Update queue tree "${formData.name}"`,
      })
    } else {
      addChange({
        operation: 'add',
        path: '/queue/tree',
        properties,
        description: `Add queue tree "${formData.name}" (parent: ${formData.parent || 'global'})`,
      })
    }
    setTreeDialogOpen(false)
    setEditingTree(null)
  }, [editingTree, addChange])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const error = simpleError || treeError
  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-error">
        <AlertCircle className="h-4 w-4" />
        <span>Failed to load queue data: {error.message}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Queue Management</h3>
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
          onClick={() => setSubTab('simple')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
            subTab === 'simple'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary',
          )}
        >
          <span className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            Simple Queues
          </span>
        </button>
        <button
          onClick={() => setSubTab('tree')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
            subTab === 'tree'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary',
          )}
        >
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            Queue Trees
          </span>
        </button>
      </div>

      {/* Tab Content */}
      {subTab === 'simple' && (
        <SimpleQueuesTable
          entries={simpleQueues}
          isLoading={loadingSimple}
          maxBandwidth={maxBandwidth}
          onAdd={handleAddSimple}
          onEdit={handleEditSimple}
          onToggle={handleToggleSimple}
          onDelete={handleDeleteSimple}
        />
      )}

      {subTab === 'tree' && (
        <QueueTreeView
          flatNodes={flatNodes}
          isLoading={loadingTree}
          onAdd={handleAddTree}
          onEdit={handleEditTree}
          onDelete={handleDeleteTree}
        />
      )}

      {/* Simple Queue Dialog */}
      <SimpleQueueDialog
        open={simpleDialogOpen}
        onOpenChange={setSimpleDialogOpen}
        entry={editingSimple}
        onSave={handleSaveSimple}
      />

      {/* Queue Tree Dialog */}
      <QueueTreeDialog
        open={treeDialogOpen}
        onOpenChange={setTreeDialogOpen}
        entry={editingTree}
        existingNames={treeQueues.map((q) => q.name).filter(Boolean)}
        onSave={handleSaveTree}
      />

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
// Simple Queues Table
// ---------------------------------------------------------------------------

function SimpleQueuesTable({
  entries,
  isLoading,
  maxBandwidth,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  entries: Record<string, string>[]
  isLoading: boolean
  maxBandwidth: number
  onAdd: () => void
  onEdit: (entry: Record<string, string>) => void
  onToggle: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading simple queues...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Queue
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-secondary gap-2">
          <Gauge className="h-8 w-8 opacity-40" />
          <p className="text-sm">No simple queues configured.</p>
          <p className="text-xs text-text-muted">Add a queue to manage bandwidth limits.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-elevated/50 border-b border-border">
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Status</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Name</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Target</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Max Limit</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Bandwidth</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Burst</th>
                <th className="text-center px-3 py-2 text-text-secondary font-medium">Priority</th>
                <th className="text-right px-3 py-2 text-text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const isDisabled = entry.disabled === 'true' || entry.disabled === 'yes'
                const { upload, download } = parseMaxLimit(entry['max-limit'] || '')
                const uploadBytes = bandwidthToBytes(upload)
                const downloadBytes = bandwidthToBytes(download)
                const uploadPct = maxBandwidth > 0 ? Math.min((uploadBytes / maxBandwidth) * 100, 100) : 0
                const downloadPct = maxBandwidth > 0 ? Math.min((downloadBytes / maxBandwidth) * 100, 100) : 0
                const burstLimit = entry['burst-limit'] || ''

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
                    <td className="px-3 py-2 font-mono text-text-secondary text-xs">{entry.target || '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5 font-mono text-xs">
                        <span className="flex items-center gap-1 text-text-primary">
                          <ArrowUp className="h-3 w-3 text-success" />
                          {formatBandwidth(upload)}
                        </span>
                        <span className="flex items-center gap-1 text-text-primary">
                          <ArrowDown className="h-3 w-3 text-accent" />
                          {formatBandwidth(download)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1 min-w-[80px]">
                        <div className="flex items-center gap-1">
                          <ArrowUp className="h-2.5 w-2.5 text-success shrink-0" />
                          <div className="h-1.5 flex-1 bg-elevated rounded-full overflow-hidden">
                            <div
                              className="h-full bg-success rounded-full transition-all"
                              style={{ width: `${uploadPct}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <ArrowDown className="h-2.5 w-2.5 text-accent shrink-0" />
                          <div className="h-1.5 flex-1 bg-elevated rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent rounded-full transition-all"
                              style={{ width: `${downloadPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-text-muted text-xs font-mono">
                      {burstLimit || '-'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge className={cn('text-[10px]', priorityColor(entry.priority || '8'))}>
                        {entry.priority || '8'}
                      </Badge>
                    </td>
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
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Queue Tree View
// ---------------------------------------------------------------------------

function QueueTreeView({
  flatNodes,
  isLoading,
  onAdd,
  onEdit,
  onDelete,
}: {
  flatNodes: TreeNode[]
  isLoading: boolean
  onAdd: () => void
  onEdit: (entry: Record<string, string>) => void
  onDelete: (entry: Record<string, string>) => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading queue trees...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Queue Tree
        </Button>
      </div>

      {flatNodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-secondary gap-2">
          <GitBranch className="h-8 w-8 opacity-40" />
          <p className="text-sm">No queue trees configured.</p>
          <p className="text-xs text-text-muted">Queue trees provide hierarchical bandwidth management.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-elevated/50 border-b border-border">
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Name</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Parent</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Packet Mark</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Queue</th>
                <th className="text-center px-3 py-2 text-text-secondary font-medium">Priority</th>
                <th className="text-left px-3 py-2 text-text-secondary font-medium">Max Limit</th>
                <th className="text-right px-3 py-2 text-text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {flatNodes.map((node, i) => {
                const entry = node.entry
                return (
                  <tr
                    key={entry['.id'] || i}
                    className="border-b border-border last:border-0 hover:bg-elevated/30 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: `${node.depth * 16}px` }}
                      >
                        {node.depth > 0 && (
                          <span className="border-l-2 border-border h-4 mr-1" />
                        )}
                        <span className="text-text-primary font-medium">{entry.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-text-secondary text-xs">
                      {entry.parent || 'global'}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-secondary text-xs">
                      {entry['packet-mark'] || '-'}
                    </td>
                    <td className="px-3 py-2 text-text-secondary text-xs">
                      {entry.queue || 'default'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge className={cn('text-[10px]', priorityColor(entry.priority || '8'))}>
                        {entry.priority || '8'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-text-primary text-xs">
                      {entry['max-limit'] ? formatBandwidth(entry['max-limit']) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => onEdit(entry)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
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
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Simple Queue Dialog
// ---------------------------------------------------------------------------

function SimpleQueueDialog({
  open,
  onOpenChange,
  entry,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  onSave: (data: SimpleQueueFormData) => void
}) {
  const isEditing = !!entry

  const [formData, setFormData] = useState<SimpleQueueFormData>({
    name: '',
    target: '',
    'max-limit-upload': '',
    'max-limit-download': '',
    'burst-limit-upload': '',
    'burst-limit-download': '',
    'burst-threshold-upload': '',
    'burst-threshold-download': '',
    'burst-time': '',
    priority: '8',
    disabled: 'no',
  })

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      if (entry) {
        const { upload: maxUp, download: maxDown } = parseMaxLimit(entry['max-limit'] || '')
        const { upload: burstUp, download: burstDown } = parseMaxLimit(entry['burst-limit'] || '')
        const { upload: threshUp, download: threshDown } = parseMaxLimit(entry['burst-threshold'] || '')
        setFormData({
          name: entry.name || '',
          target: entry.target || '',
          'max-limit-upload': maxUp !== '0' ? maxUp : '',
          'max-limit-download': maxDown !== '0' ? maxDown : '',
          'burst-limit-upload': burstUp !== '0' ? burstUp : '',
          'burst-limit-download': burstDown !== '0' ? burstDown : '',
          'burst-threshold-upload': threshUp !== '0' ? threshUp : '',
          'burst-threshold-download': threshDown !== '0' ? threshDown : '',
          'burst-time': entry['burst-time'] || '',
          priority: entry.priority || '8',
          disabled: entry.disabled || 'no',
        })
      } else {
        setFormData({
          name: '',
          target: '',
          'max-limit-upload': '',
          'max-limit-download': '',
          'burst-limit-upload': '',
          'burst-limit-download': '',
          'burst-threshold-upload': '',
          'burst-threshold-download': '',
          'burst-time': '',
          priority: '8',
          disabled: 'no',
        })
      }
    }
    onOpenChange(nextOpen)
  }, [entry, onOpenChange])

  const updateField = useCallback((field: keyof SimpleQueueFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Simple Queue' : 'Add Simple Queue'}</DialogTitle>
          <DialogDescription>
            {isEditing ? `Editing "${entry?.name}"` : 'Create a new simple queue for bandwidth management'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sq-name">Name *</Label>
            <Input
              id="sq-name"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="e.g. client-01-limit"
            />
          </div>

          {/* Target */}
          <div className="space-y-1.5">
            <Label htmlFor="sq-target">Target *</Label>
            <Input
              id="sq-target"
              value={formData.target}
              onChange={(e) => updateField('target', e.target.value)}
              placeholder="IP, subnet, or interface (e.g. 192.168.1.0/24)"
            />
            <p className="text-[10px] text-text-muted">IP address, subnet, or interface name</p>
          </div>

          {/* Max Limit */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-text-secondary">Max Limit</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sq-max-up" className="flex items-center gap-1">
                  <ArrowUp className="h-3 w-3 text-success" />
                  Upload
                </Label>
                <Input
                  id="sq-max-up"
                  value={formData['max-limit-upload']}
                  onChange={(e) => updateField('max-limit-upload', e.target.value)}
                  placeholder="e.g. 10M"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sq-max-down" className="flex items-center gap-1">
                  <ArrowDown className="h-3 w-3 text-accent" />
                  Download
                </Label>
                <Input
                  id="sq-max-down"
                  value={formData['max-limit-download']}
                  onChange={(e) => updateField('max-limit-download', e.target.value)}
                  placeholder="e.g. 50M"
                  className="font-mono"
                />
              </div>
            </div>
          </fieldset>

          {/* Burst Limit (optional) */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-text-secondary">Burst Limit (optional)</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sq-burst-up" className="flex items-center gap-1">
                  <ArrowUp className="h-3 w-3 text-success" />
                  Upload
                </Label>
                <Input
                  id="sq-burst-up"
                  value={formData['burst-limit-upload']}
                  onChange={(e) => updateField('burst-limit-upload', e.target.value)}
                  placeholder="e.g. 20M"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sq-burst-down" className="flex items-center gap-1">
                  <ArrowDown className="h-3 w-3 text-accent" />
                  Download
                </Label>
                <Input
                  id="sq-burst-down"
                  value={formData['burst-limit-download']}
                  onChange={(e) => updateField('burst-limit-download', e.target.value)}
                  placeholder="e.g. 100M"
                  className="font-mono"
                />
              </div>
            </div>
          </fieldset>

          {/* Burst Threshold (optional) */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-text-secondary">Burst Threshold (optional)</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sq-thresh-up" className="flex items-center gap-1">
                  <ArrowUp className="h-3 w-3 text-success" />
                  Upload
                </Label>
                <Input
                  id="sq-thresh-up"
                  value={formData['burst-threshold-upload']}
                  onChange={(e) => updateField('burst-threshold-upload', e.target.value)}
                  placeholder="e.g. 8M"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sq-thresh-down" className="flex items-center gap-1">
                  <ArrowDown className="h-3 w-3 text-accent" />
                  Download
                </Label>
                <Input
                  id="sq-thresh-down"
                  value={formData['burst-threshold-download']}
                  onChange={(e) => updateField('burst-threshold-download', e.target.value)}
                  placeholder="e.g. 40M"
                  className="font-mono"
                />
              </div>
            </div>
          </fieldset>

          {/* Burst Time */}
          <div className="space-y-1.5">
            <Label htmlFor="sq-burst-time">Burst Time (optional)</Label>
            <Input
              id="sq-burst-time"
              value={formData['burst-time']}
              onChange={(e) => updateField('burst-time', e.target.value)}
              placeholder="e.g. 8s"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>Priority (1=highest, 8=lowest)</Label>
            <Select value={formData.priority} onValueChange={(v) => updateField('priority', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} {p === 1 ? '(highest)' : p === 8 ? '(lowest)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Disabled */}
          <div className="flex items-center gap-2">
            <input
              id="sq-disabled"
              type="checkbox"
              checked={formData.disabled === 'yes' || formData.disabled === 'true'}
              onChange={(e) => updateField('disabled', e.target.checked ? 'yes' : 'no')}
              className="rounded border-border"
            />
            <Label htmlFor="sq-disabled">Disabled</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(formData)}
            disabled={!formData.name || !formData.target}
          >
            {isEditing ? 'Stage Change' : 'Stage Addition'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Queue Tree Dialog
// ---------------------------------------------------------------------------

function QueueTreeDialog({
  open,
  onOpenChange,
  entry,
  existingNames,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Record<string, string> | null
  existingNames: string[]
  onSave: (data: QueueTreeFormData) => void
}) {
  const isEditing = !!entry

  const [formData, setFormData] = useState<QueueTreeFormData>({
    name: '',
    parent: 'global',
    'packet-mark': '',
    queue: 'default',
    priority: '8',
    'max-limit': '',
  })

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      if (entry) {
        setFormData({
          name: entry.name || '',
          parent: entry.parent || 'global',
          'packet-mark': entry['packet-mark'] || '',
          queue: entry.queue || 'default',
          priority: entry.priority || '8',
          'max-limit': entry['max-limit'] || '',
        })
      } else {
        setFormData({
          name: '',
          parent: 'global',
          'packet-mark': '',
          queue: 'default',
          priority: '8',
          'max-limit': '',
        })
      }
    }
    onOpenChange(nextOpen)
  }, [entry, onOpenChange])

  const updateField = useCallback((field: keyof QueueTreeFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const parentOptions = ['global', ...existingNames.filter((n) => n !== entry?.name)]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Queue Tree' : 'Add Queue Tree'}</DialogTitle>
          <DialogDescription>
            {isEditing ? `Editing "${entry?.name}"` : 'Create a new queue tree entry'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="qt-name">Name *</Label>
            <Input
              id="qt-name"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Queue tree name"
            />
          </div>

          {/* Parent */}
          <div className="space-y-1.5">
            <Label>Parent</Label>
            <Select value={formData.parent} onValueChange={(v) => updateField('parent', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {parentOptions.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Packet Mark */}
          <div className="space-y-1.5">
            <Label htmlFor="qt-mark">Packet Mark</Label>
            <Input
              id="qt-mark"
              value={formData['packet-mark']}
              onChange={(e) => updateField('packet-mark', e.target.value)}
              placeholder="e.g. client-download"
            />
          </div>

          {/* Queue Type */}
          <div className="space-y-1.5">
            <Label htmlFor="qt-queue">Queue Type</Label>
            <Input
              id="qt-queue"
              value={formData.queue}
              onChange={(e) => updateField('queue', e.target.value)}
              placeholder="default"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>Priority (1=highest, 8=lowest)</Label>
            <Select value={formData.priority} onValueChange={(v) => updateField('priority', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} {p === 1 ? '(highest)' : p === 8 ? '(lowest)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Max Limit */}
          <div className="space-y-1.5">
            <Label htmlFor="qt-max">Max Limit</Label>
            <Input
              id="qt-max"
              value={formData['max-limit']}
              onChange={(e) => updateField('max-limit', e.target.value)}
              placeholder="e.g. 10M"
              className="font-mono"
            />
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
