/**
 * ConfigEditorPage -- main config editor page with tree sidebar navigation,
 * entry table, add/edit/delete forms, and command executor.
 *
 * This page requires a device to be selected. If accessed via the sidebar
 * without a device, it shows a device picker. Once a device is selected,
 * users can browse RouterOS menu paths and manage entries.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Terminal, ChevronRight, Loader2, WifiOff, Building2 } from 'lucide-react'
import { configEditorApi } from '@/lib/configEditorApi'
import { metricsApi } from '@/lib/api'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { MenuTree } from './MenuTree'
import { EntryTable } from './EntryTable'
import { EntryForm } from './EntryForm'
import { CommandExecutor } from './CommandExecutor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function ConfigEditorPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isSuper = isSuperAdmin(user)
  const { selectedTenantId } = useUIStore()
  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState('/interface')

  // Form state
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add')
  const [editingEntry, setEditingEntry] = useState<Record<string, string> | undefined>()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingEntry, setDeletingEntry] = useState<Record<string, string> | null>(null)

  // Fetch fleet devices for device selection
  const { data: devices, isLoading: devicesLoading } = useQuery({
    queryKey: ['fleet-devices', tenantId],
    queryFn: () => metricsApi.fleetSummary(tenantId),
    enabled: !!tenantId,
  })

  // Get selected device info
  const selectedDevice = devices?.find((d) => d.id === selectedDeviceId)
  const isOnline = selectedDevice?.status === 'online'

  // Browse entries at current path
  const {
    data: browseData,
    isLoading: browsing,
    error: browseError,
  } = useQuery({
    queryKey: ['config-editor', selectedDeviceId, currentPath],
    queryFn: () => configEditorApi.browse(tenantId, selectedDeviceId!, currentPath),
    enabled: !!selectedDeviceId && isOnline,
    retry: false,
  })

  const entries = browseData?.entries ?? []
  const columns = entries.length > 0 ? Object.keys(entries[0]).filter((k) => k !== '.id') : []

  // Mutations
  const addMutation = useMutation({
    mutationFn: (props: Record<string, string>) =>
      configEditorApi.addEntry(tenantId, selectedDeviceId!, currentPath, props),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-editor', selectedDeviceId, currentPath] })
      toast({ title: 'Entry added successfully' })
    },
    onError: (err) => toast({ title: 'Failed to add entry', description: String(err), variant: 'destructive' }),
  })

  const setMutation = useMutation({
    mutationFn: ({ entryId, props }: { entryId: string; props: Record<string, string> }) =>
      configEditorApi.setEntry(tenantId, selectedDeviceId!, currentPath, entryId, props),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-editor', selectedDeviceId, currentPath] })
      toast({ title: 'Entry updated successfully' })
    },
    onError: (err) => toast({ title: 'Failed to update entry', description: String(err), variant: 'destructive' }),
  })

  const removeMutation = useMutation({
    mutationFn: (entryId: string) =>
      configEditorApi.removeEntry(tenantId, selectedDeviceId!, currentPath, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-editor', selectedDeviceId, currentPath] })
      toast({ title: 'Entry removed' })
      setDeleteConfirmOpen(false)
      setDeletingEntry(null)
    },
    onError: (err) => toast({ title: 'Failed to remove entry', description: String(err), variant: 'destructive' }),
  })

  const handleAdd = () => {
    setFormMode('add')
    setEditingEntry(undefined)
    setFormOpen(true)
  }

  const handleEdit = (entry: Record<string, string>) => {
    setFormMode('edit')
    setEditingEntry(entry)
    setFormOpen(true)
  }

  const handleDelete = (entry: Record<string, string>) => {
    setDeletingEntry(entry)
    setDeleteConfirmOpen(true)
  }

  const handleFormSubmit = async (properties: Record<string, string>) => {
    if (formMode === 'add') {
      await addMutation.mutateAsync(properties)
    } else if (editingEntry) {
      const entryId = editingEntry['.id']
      if (!entryId) throw new Error('Entry has no .id field')
      await setMutation.mutateAsync({ entryId, props: properties })
    }
  }

  const handleConfirmDelete = () => {
    if (deletingEntry?.['.id']) {
      removeMutation.mutate(deletingEntry['.id'])
    }
  }

  // Breadcrumb segments
  const pathSegments = currentPath.split('/').filter(Boolean)

  // Super_admin with no tenant selected -- prompt to use header org selector
  if (isSuper && !tenantId) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-6 py-3 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-text-muted" />
          <h1 className="text-sm font-medium text-text-primary">Config Editor</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm">
            <Building2 className="h-8 w-8 mx-auto text-accent" />
            <div className="text-sm text-text-secondary">
              Select an organization from the header to view its devices.
            </div>
            <div className="text-xs text-text-muted">
              Use the organization selector in the top navigation bar.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Device selection view
  if (!selectedDeviceId) {
    const onlineDevices = devices?.filter((d) => d.status === 'online') ?? []

    return (
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-6 py-3 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-text-muted" />
          <h1 className="text-sm font-medium text-text-primary">Config Editor</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm">
            <Terminal className="h-8 w-8 mx-auto text-accent" />
            <div className="text-sm text-text-secondary">Select a device to open the config editor.</div>
            {devicesLoading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading devices...
              </div>
            ) : onlineDevices.length > 0 ? (
              <Select onValueChange={(v) => setSelectedDeviceId(v)}>
                <SelectTrigger className="bg-elevated/50 border-border" data-testid="select-device">
                  <SelectValue placeholder="Choose device..." />
                </SelectTrigger>
                <SelectContent>
                  {onlineDevices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.hostname} ({d.ip_address})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-xs text-text-muted">
                {devices && devices.length > 0
                  ? 'All devices are currently offline'
                  : 'No devices found for this organization'}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full" data-testid="config-editor">
      {/* Header */}
      <div className="border-b border-border px-4 py-2 flex items-center gap-3">
        <Terminal className="h-4 w-4 text-text-muted" />
        <h1 className="text-sm font-medium text-text-primary">Config Editor</h1>
        <span className="text-xs text-text-muted">|</span>
        <span className="text-xs text-text-secondary">{selectedDevice?.hostname ?? ''}</span>
        <span className="text-xs text-text-muted">{selectedDevice?.ip_address ?? ''}</span>
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            isOnline ? 'bg-success' : 'bg-error',
          )}
        />
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-6"
            onClick={() => setSelectedDeviceId(null)}
          >
            Change Device
          </Button>
        </div>
      </div>

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-warning/10 border-b border-warning/20 px-4 py-2 flex items-center gap-2 text-xs text-warning">
          <WifiOff className="h-3.5 w-3.5" />
          This device is currently offline. The config editor needs a live connection.
        </div>
      )}

      {/* Breadcrumb */}
      <div className="px-4 py-1.5 border-b border-border/50 flex items-center gap-1 text-xs">
        <button
          onClick={() => setCurrentPath('/')}
          className="text-text-muted hover:text-text-secondary transition-colors"
        >
          /
        </button>
        {pathSegments.map((seg, i) => {
          const path = '/' + pathSegments.slice(0, i + 1).join('/')
          return (
            <span key={path} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-text-muted" />
              <button
                onClick={() => setCurrentPath(path)}
                className={cn(
                  'transition-colors',
                  i === pathSegments.length - 1
                    ? 'text-text-primary font-medium'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {seg}
              </button>
            </span>
          )
        })}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Menu Tree */}
        <div className="w-56 border-r border-border overflow-hidden flex-shrink-0">
          <MenuTree onPathSelect={setCurrentPath} currentPath={currentPath} />
        </div>

        {/* Center: Entry Table */}
        <div className="flex-1 overflow-auto p-4">
          <EntryTable
            entries={entries}
            currentPath={currentPath}
            isLoading={browsing}
            error={
              browseError
                ? browseError instanceof Error
                  ? browseError.message
                  : 'Failed to browse menu path'
                : null
            }
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        </div>
      </div>

      {/* Bottom: Command Executor */}
      <CommandExecutor
        tenantId={tenantId}
        deviceId={selectedDeviceId}
        currentPath={currentPath}
      />

      {/* Entry Form Dialog */}
      <EntryForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        mode={formMode}
        entry={editingEntry}
        columns={columns}
        onSubmit={handleFormSubmit}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={(o) => !o && setDeleteConfirmOpen(false)}>
        <DialogContent className="max-w-sm bg-surface border-border text-text-primary">
          <DialogHeader>
            <DialogTitle className="text-sm">Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-text-secondary">
            Are you sure you want to remove this entry? This action will take effect on the device
            immediately.
          </p>

          {/* Entry details */}
          {deletingEntry && (
            <div className="space-y-1.5 bg-elevated/50 rounded-lg p-3">
              {deletingEntry['.id'] && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">ID</span>
                  <span className="font-mono text-text-secondary">{deletingEntry['.id']}</span>
                </div>
              )}
              {deletingEntry.chain && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Chain</span>
                  <span className="text-text-primary">{deletingEntry.chain}</span>
                </div>
              )}
              {deletingEntry.action && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Action</span>
                  <span className="text-text-primary">{deletingEntry.action}</span>
                </div>
              )}
              {deletingEntry.protocol && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Protocol</span>
                  <span className="text-text-primary">{deletingEntry.protocol}</span>
                </div>
              )}
              {deletingEntry['dst-port'] && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Port</span>
                  <span className="font-mono text-text-primary">{deletingEntry['dst-port']}</span>
                </div>
              )}
              {deletingEntry['src-address'] && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Source</span>
                  <span className="font-mono text-text-primary">{deletingEntry['src-address']}</span>
                </div>
              )}
              {deletingEntry.address && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Address</span>
                  <span className="font-mono text-text-primary">{deletingEntry.address}</span>
                </div>
              )}
              {deletingEntry.name && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Name</span>
                  <span className="text-text-primary">{deletingEntry.name}</span>
                </div>
              )}
              {deletingEntry.comment && (
                <div className="flex gap-2 text-xs">
                  <span className="text-text-muted w-16 shrink-0">Comment</span>
                  <span className="text-text-secondary italic">{deletingEntry.comment}</span>
                </div>
              )}
            </div>
          )}

          {/* Backup before delete option */}
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-border"
              defaultChecked={false}
            />
            Create config backup before deleting
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="text-xs"
              onClick={handleConfirmDelete}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
