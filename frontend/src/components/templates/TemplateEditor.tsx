/**
 * TemplateEditor -- full-page form for creating and editing config templates.
 * Includes name, description, monospace content editor, tag input,
 * and auto-detected variable table.
 */

import { useState } from 'react'
import { X, Plus, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  type TemplateResponse,
  type VariableDef,
  type TemplateCreateData,
} from '@/lib/templatesApi'

interface TemplateEditorProps {
  tenantId: string
  template?: TemplateResponse | null
  onSave: (data: TemplateCreateData) => Promise<void>
  onCancel: () => void
}

const VARIABLE_TYPES = ['string', 'ip', 'integer', 'boolean', 'subnet'] as const

export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [tags, setTags] = useState<string[]>(template?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [variables, setVariables] = useState<VariableDef[]>(template?.variables ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const detectVariables = () => {
    // Simple regex-based detection of {{ variable }} patterns
    const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
    const found = new Set<string>()
    let match
    while ((match = regex.exec(content)) !== null) {
      const varName = match[1]
      // Skip 'device' built-in and its properties
      if (varName !== 'device') {
        found.add(varName)
      }
    }

    // Also detect dot-access variables like {{ device.hostname }}
    // These are built-in and we skip them

    const existingNames = new Set(variables.map((v) => v.name))
    const newVars: VariableDef[] = [...variables]
    for (const name of found) {
      if (!existingNames.has(name)) {
        newVars.push({ name, type: 'string', default: null, description: null })
      }
    }
    setVariables(newVars)
  }

  const updateVariable = (index: number, field: keyof VariableDef, value: string | null) => {
    setVariables(
      variables.map((v, i) =>
        i === index ? { ...v, [field]: value } : v,
      ),
    )
  }

  const removeVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index))
  }

  const addVariable = () => {
    setVariables([...variables, { name: '', type: 'string', default: null, description: null }])
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Template name is required')
      return
    }
    if (!content.trim()) {
      setError('Template content is required')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        content,
        variables: variables.filter((v) => v.name.trim()),
        tags,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-primary">
          {template ? 'Edit Template' : 'Create Template'}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" className="text-xs gap-1" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save Template
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {error && (
          <div className="text-xs text-error bg-error/10 rounded px-3 py-2">{error}</div>
        )}

        {/* Name */}
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Basic Firewall Setup"
            className="bg-elevated/50 border-border"
          />
        </div>

        {/* Description */}
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Description</Label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this template configure?"
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-md bg-elevated/50 border border-border text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-border-bright"
          />
        </div>

        {/* Content */}
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Template Content (RouterOS commands with Jinja2 variables)</Label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`# Example: Set system identity\n/system identity set name={{ device.hostname }}-{{ site_name }}\n\n# Add IP address\n/ip address add address={{ mgmt_ip }}/24 interface=ether1`}
            rows={16}
            className="w-full px-3 py-2 text-sm rounded-md bg-background border border-border text-success placeholder:text-text-muted font-mono resize-y focus:outline-none focus:ring-1 focus:ring-border-bright leading-relaxed"
          />
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Tags</Label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-elevated text-text-secondary"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="hover:text-text-primary transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Add tag..."
              className="h-7 text-xs bg-elevated/50 border-border flex-1"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addTag}>
              Add
            </Button>
          </div>
        </div>

        {/* Variables */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-text-secondary">Variables</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={detectVariables}
              >
                <Sparkles className="h-3 w-3" />
                Scan for Variables
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={addVariable}
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
          </div>

          <div className="text-[10px] text-text-muted mb-1">
            Built-in: {'{{ device.hostname }}'}, {'{{ device.ip }}'}, {'{{ device.model }}'} -- auto-populated per device
          </div>

          {variables.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    <th className="text-left px-3 py-1.5 text-text-secondary font-medium">Name</th>
                    <th className="text-left px-3 py-1.5 text-text-secondary font-medium w-28">Type</th>
                    <th className="text-left px-3 py-1.5 text-text-secondary font-medium">Default</th>
                    <th className="text-left px-3 py-1.5 text-text-secondary font-medium">Description</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {variables.map((v, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-2 py-1">
                        <Input
                          value={v.name}
                          onChange={(e) => updateVariable(i, 'name', e.target.value)}
                          className="h-6 text-xs bg-elevated/50 border-border font-mono"
                          placeholder="variable_name"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={v.type}
                          onValueChange={(val) => updateVariable(i, 'type', val)}
                        >
                          <SelectTrigger className="h-6 text-xs bg-elevated/50 border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VARIABLE_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={v.default ?? ''}
                          onChange={(e) => updateVariable(i, 'default', e.target.value || null)}
                          className="h-6 text-xs bg-elevated/50 border-border"
                          placeholder="default value"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={v.description ?? ''}
                          onChange={(e) => updateVariable(i, 'description', e.target.value || null)}
                          className="h-6 text-xs bg-elevated/50 border-border"
                          placeholder="description"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <button
                          onClick={() => removeVariable(i)}
                          className="p-1 rounded hover:bg-error/20 text-text-muted hover:text-error transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
