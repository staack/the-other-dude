/**
 * EntryForm -- dialog for adding or editing a RouterOS entry.
 * Dynamically generates form fields based on the entry properties
 * with type heuristics for boolean, IP, and numeric fields.
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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

/** Fields that are read-only and should be skipped in edit mode */
const SKIP_FIELDS = new Set(['.id', 'running', 'dynamic', 'default', 'invalid'])

/** Fields that should render as checkboxes */
const BOOLEAN_FIELDS = new Set([
  'disabled',
  'running',
  'active',
  'dynamic',
  'default',
  'invalid',
  'comment',
  'passthrough',
  'logging',
])

function isBooleanValue(value: string): boolean {
  return ['true', 'false', 'yes', 'no'].includes(value.toLowerCase())
}

function isIpLike(value: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?$/.test(value)
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value)
}

interface EntryFormProps {
  open: boolean
  onClose: () => void
  mode: 'add' | 'edit'
  entry?: Record<string, string>
  /** All columns from the table (used for add mode field generation) */
  columns: string[]
  onSubmit: (properties: Record<string, string>) => Promise<void>
}

export function EntryForm({ open, onClose, mode, entry, columns, onSubmit }: EntryFormProps) {
  const editableFields =
    mode === 'edit' && entry
      ? Object.keys(entry).filter((k) => !SKIP_FIELDS.has(k))
      : columns.filter((k) => !SKIP_FIELDS.has(k))

  const [values, setValues] = useState<Record<string, string>>(() => {
    if (mode === 'edit' && entry) {
      const v: Record<string, string> = {}
      for (const key of editableFields) {
        v[key] = entry[key] ?? ''
      }
      return v
    }
    // Add mode: empty values for each column
    const v: Record<string, string> = {}
    for (const key of editableFields) {
      v[key] = ''
    }
    return v
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      // Filter out empty values for add mode
      const properties: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) {
        if (mode === 'add' && v === '') continue
        properties[k] = v
      }
      await onSubmit(properties)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setSubmitting(false)
    }
  }

  const renderField = (key: string) => {
    const value = values[key] ?? ''
    const originalValue = entry?.[key] ?? ''

    // Determine field type via heuristics
    if (BOOLEAN_FIELDS.has(key) || isBooleanValue(originalValue || value)) {
      const checked = value === 'true' || value === 'yes'
      return (
        <div key={key} className="flex items-center gap-2">
          <Checkbox
            id={key}
            checked={checked}
            onCheckedChange={(c) =>
              setValues((prev) => ({ ...prev, [key]: c ? 'true' : 'false' }))
            }
          />
          <Label htmlFor={key} className="text-xs text-text-secondary">
            {key}
          </Label>
        </div>
      )
    }

    return (
      <div key={key} className="space-y-1">
        <Label htmlFor={key} className="text-xs text-text-secondary">
          {key}
        </Label>
        <Input
          id={key}
          value={value}
          onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder={
            isIpLike(originalValue) ? '0.0.0.0/0' : isNumeric(originalValue) ? '0' : ''
          }
          type={isNumeric(originalValue) && !isIpLike(originalValue) ? 'number' : 'text'}
          className="h-7 text-xs bg-elevated/50 border-border font-mono"
        />
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-surface border-border text-text-primary">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {mode === 'add' ? 'Add New Entry' : 'Edit Entry'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {editableFields.map(renderField)}
        </div>

        {error && (
          <div className="text-xs text-error bg-error/10 rounded px-3 py-2">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="text-xs gap-1">
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            {mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
