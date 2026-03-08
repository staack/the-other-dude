/**
 * RestorePreview — Shows impact analysis before executing a config restore.
 * Three panels: summary bar, category breakdown with risk badges, warnings.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Shield, XCircle } from 'lucide-react'
import { useState } from 'react'
import { configApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RestorePreviewProps {
  tenantId: string
  deviceId: string
  commitSha: string
  onProceed: () => void
  onCancel: () => void
  isProceedDisabled?: boolean
}

const riskBadgeColors = {
  none: 'bg-muted text-text-secondary',
  low: 'bg-success/10 text-success border-success/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  high: 'bg-destructive/10 text-destructive border-destructive/30',
} as const

export function RestorePreview({
  tenantId,
  deviceId,
  commitSha,
  onProceed,
  onCancel,
  isProceedDisabled,
}: RestorePreviewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['restore-preview', tenantId, deviceId, commitSha],
    queryFn: () => configApi.previewRestore(tenantId, deviceId, commitSha),
  })

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
        <div className="h-16 rounded-lg bg-muted animate-pulse" />
      </div>
    )
  }

  if (error || !preview) {
    return (
      <div className="p-4 space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Preview failed</p>
            <p className="text-xs text-text-secondary mt-1">
              Could not analyze the config. You may still proceed manually.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onProceed}>Proceed Anyway</Button>
        </div>
      </div>
    )
  }

  const { diff, categories, warnings, validation } = preview
  const hasHighRisk = categories.some((c) => c.risk === 'high')
  const changedCategories = categories.filter((c) => c.adds > 0 || c.removes > 0)

  return (
    <div className="space-y-4 p-4">
      {/* Validation errors */}
      {!validation.valid && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
          <p className="text-sm font-medium text-destructive flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            Validation errors found
          </p>
          {validation.errors.map((err, i) => (
            <p key={i} className="text-xs text-destructive/80 ml-6">{err}</p>
          ))}
        </div>
      )}

      {/* Summary bar */}
      <div className="rounded-lg border border-border bg-surface-raised p-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-success font-mono">+{diff.added}</span>
          <span className="text-destructive font-mono">-{diff.removed}</span>
          <span className="text-text-secondary">
            across {changedCategories.length} categor{changedCategories.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        {hasHighRisk ? (
          <span className="text-xs font-medium text-destructive flex items-center gap-1">
            <Shield className="h-3 w-3" /> High risk
          </span>
        ) : (
          <span className="text-xs font-medium text-success flex items-center gap-1">
            <CheckCircle className="h-3 w-3" /> Low risk
          </span>
        )}
      </div>

      {/* Category breakdown */}
      {changedCategories.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {changedCategories.map((cat) => (
            <button
              key={cat.path}
              className="w-full px-3 py-2 flex items-center justify-between hover:bg-surface-raised/50 transition-colors"
              onClick={() => togglePath(cat.path)}
            >
              <div className="flex items-center gap-2 text-sm">
                {expandedPaths.has(cat.path) ? (
                  <ChevronDown className="h-3 w-3 text-text-secondary" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-text-secondary" />
                )}
                <code className="text-xs font-mono text-text-primary">{cat.path}</code>
              </div>
              <div className="flex items-center gap-3">
                {cat.adds > 0 && <span className="text-xs text-success">+{cat.adds}</span>}
                {cat.removes > 0 && <span className="text-xs text-destructive">-{cat.removes}</span>}
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded border',
                  riskBadgeColors[cat.risk],
                )}>
                  {cat.risk}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning flex items-start gap-2">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onProceed}
          disabled={isProceedDisabled || !validation.valid}
        >
          {!validation.valid ? 'Cannot Restore (Invalid)' : 'Proceed with Restore'}
        </Button>
      </div>
    </div>
  )
}
