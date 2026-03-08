/**
 * SimpleFormSection -- A card component wrapping a group of form fields with
 * an icon, title, and optional description.
 */

import type { LucideIcon } from 'lucide-react'

interface SimpleFormSectionProps {
  icon: LucideIcon
  title: string
  description?: string
  children: React.ReactNode
}

export function SimpleFormSection({
  icon: Icon,
  title,
  description,
  children,
}: SimpleFormSectionProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4.5 w-4.5 text-accent flex-shrink-0" />
        <div>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          {description && (
            <p className="text-xs text-text-muted mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
