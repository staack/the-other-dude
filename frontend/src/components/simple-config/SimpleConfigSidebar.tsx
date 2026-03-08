/**
 * SimpleConfigSidebar -- Vertical category navigation for Simple mode.
 *
 * Shows 7 categories with icons, highlighting the active category with a
 * left accent border. Includes a "Switch to Standard" shortcut at bottom.
 */

import { Sliders } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SIMPLE_CATEGORIES } from '@/lib/simpleConfigSchema'

interface SimpleConfigSidebarProps {
  activeCategory: string
  onCategoryChange: (id: string) => void
  onSwitchToStandard?: () => void
}

export function SimpleConfigSidebar({
  activeCategory,
  onCategoryChange,
  onSwitchToStandard,
}: SimpleConfigSidebarProps) {
  return (
    <div className="w-48 flex-shrink-0 flex flex-col min-h-[400px]">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 px-3">
        Configuration
      </p>
      <div className="space-y-1">
        {SIMPLE_CATEGORIES.map((cat) => {
          const Icon = cat.icon
          const isActive = activeCategory === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => onCategoryChange(cat.id)}
              className={cn(
                'flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-r-lg text-sm transition-colors',
                isActive
                  ? 'bg-accent/10 text-accent border-l-2 border-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-elevated/50 border-l-2 border-transparent',
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{cat.label}</span>
            </button>
          )
        })}
      </div>

      {onSwitchToStandard && (
        <div className="mt-auto pt-4 border-t border-border/50">
          <button
            onClick={onSwitchToStandard}
            className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <Sliders className="h-3.5 w-3.5" />
            Switch to Standard mode
          </button>
        </div>
      )}
    </div>
  )
}
