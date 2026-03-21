/**
 * TemplatesPage -- config template list page with tag filtering,
 * create/edit/delete actions, and push wizard access.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/lib/store'
import {
  FileCode,
  Plus,
  Pencil,
  Trash2,
  Play,
  Tag,
  Loader2,
} from 'lucide-react'
import {
  templatesApi,
  type TemplateResponse,
} from '@/lib/templatesApi'
import { tenantsApi } from '@/lib/api'
import { useAuth, canWrite, isSuperAdmin } from '@/lib/auth'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { CardGridSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { TemplateEditor } from './TemplateEditor'
import { TemplatePushWizard } from './TemplatePushWizard'

export function TemplatesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isSuper = isSuperAdmin(user)

  const { selectedTenantId, setSelectedTenantId } = useUIStore()

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list(),
    enabled: isSuper,
  })

  const tenantId = isSuper ? (selectedTenantId ?? '') : (user?.tenant_id ?? '')
  const writable = canWrite(user)

  const [tagFilter, setTagFilter] = useState<string | undefined>()
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingTemplate, setEditingTemplate] = useState<TemplateResponse | null>(null)
  const [pushTemplate, setPushTemplate] = useState<TemplateResponse | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Fetch templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates', tenantId, tagFilter],
    queryFn: () => templatesApi.list(tenantId, tagFilter),
    enabled: !!tenantId,
  })

  // Get unique tags from all templates
  const allTags = Array.from(
    new Set((templates ?? []).flatMap((t) => t.tags)),
  ).sort()

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => templatesApi.delete(tenantId, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates', tenantId] })
      toast({ title: 'Template deleted' })
      setDeleteConfirmId(null)
    },
    onError: (err) =>
      toast({ title: 'Delete failed', description: String(err), variant: 'destructive' }),
  })

  // Create handler
  const handleCreate = () => {
    setEditingTemplate(null)
    setView('editor')
  }

  // Edit handler
  const handleEdit = async (templateId: string) => {
    const full = await templatesApi.get(tenantId, templateId)
    setEditingTemplate(full)
    setView('editor')
  }

  // Push handler
  const handlePush = async (templateId: string) => {
    const full = await templatesApi.get(tenantId, templateId)
    setPushTemplate(full)
  }

  // Save handler
  const handleSave = async (data: Parameters<typeof templatesApi.create>[1]) => {
    if (editingTemplate) {
      await templatesApi.update(tenantId, editingTemplate.id, data)
      toast({ title: 'Template updated' })
    } else {
      await templatesApi.create(tenantId, data)
      toast({ title: 'Template created' })
    }
    queryClient.invalidateQueries({ queryKey: ['templates', tenantId] })
    setView('list')
    setEditingTemplate(null)
  }

  // Editor view
  if (view === 'editor') {
    return (
      <TemplateEditor
        tenantId={tenantId}
        template={editingTemplate}
        onSave={handleSave}
        onCancel={() => {
          setView('list')
          setEditingTemplate(null)
        }}
      />
    )
  }

  // List view
  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-text-muted" />
            <h1 className="text-sm font-medium text-text-primary">Config Templates</h1>
            {templates && (
              <span className="text-xs text-text-muted">({templates.length})</span>
            )}
          </div>
          {isSuper && tenants && tenants.length > 0 && (
            <Select value={selectedTenantId ?? ''} onValueChange={setSelectedTenantId}>
              <SelectTrigger className="w-48 h-7 text-xs">
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {writable && (
          <Button size="sm" className="text-xs gap-1" onClick={handleCreate}>
            <Plus className="h-3 w-3" />
            Create Template
          </Button>
        )}
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="px-6 py-2 border-b border-border/50 flex items-center gap-2 overflow-x-auto">
          <Tag className="h-3 w-3 text-text-muted flex-shrink-0" />
          <button
            onClick={() => setTagFilter(undefined)}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full transition-colors whitespace-nowrap',
              !tagFilter
                ? 'bg-elevated text-text-primary'
                : 'text-text-muted hover:text-text-secondary hover:bg-elevated/50',
            )}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag === tagFilter ? undefined : tag)}
              className={cn(
                'text-xs px-2 py-0.5 rounded-full transition-colors whitespace-nowrap',
                tagFilter === tag
                  ? 'bg-elevated text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-elevated/50',
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <CardGridSkeleton />
        ) : !templates || templates.length === 0 ? (
          <EmptyState
            icon={FileCode}
            title="No templates created"
            description={
              tagFilter
                ? `No templates with tag "${tagFilter}".`
                : 'Create configuration templates to streamline device setup.'
            }
            action={
              !tagFilter && writable
                ? { label: 'Create Template', onClick: handleCreate }
                : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="rounded-lg border border-border bg-panel/50 p-4 hover:bg-panel transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => handleEdit(template.id)}
                      className="text-sm font-medium text-text-primary hover:underline text-left"
                    >
                      {template.name}
                    </button>
                    {template.description && (
                      <div className="text-xs text-text-muted mt-0.5 line-clamp-1">
                        {template.description}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {template.tags.length > 0 && (
                        <div className="flex gap-1">
                          {template.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-elevated/60 text-text-secondary"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="text-[10px] text-text-muted">
                        {template.variable_count} variable(s)
                      </span>
                      <span className="text-[10px] text-text-muted">
                        Updated {formatDate(template.updated_at)}
                      </span>
                    </div>
                  </div>

                  {writable && (
                    <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                      <button
                        onClick={() => handlePush(template.id)}
                        className="p-1.5 rounded hover:bg-success/20 text-text-muted hover:text-success transition-colors"
                        title="Push to devices"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleEdit(template.id)}
                        className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(template.id)}
                        className="p-1.5 rounded hover:bg-error/20 text-text-muted hover:text-error transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Push Wizard */}
      {pushTemplate && (
        <TemplatePushWizard
          open={!!pushTemplate}
          onClose={() => setPushTemplate(null)}
          tenantId={tenantId}
          template={pushTemplate}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(o) => !o && setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-sm bg-panel border-border text-text-primary">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete Template</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-text-secondary">
            Are you sure you want to delete this template? This action cannot be undone.
            Existing push jobs will keep their rendered content.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="text-xs"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
