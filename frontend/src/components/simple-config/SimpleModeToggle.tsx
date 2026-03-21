/**
 * SimpleModeToggle -- Compact pill-shaped toggle between Simple and Standard
 * configuration modes. Matches the SafetyToggle visual style.
 */

import { LayoutGrid, Sliders } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SimpleModeToggleProps {
  mode: 'simple' | 'standard'
  onModeChange: (mode: 'simple' | 'standard') => void
}

export function SimpleModeToggle({ mode, onModeChange }: SimpleModeToggleProps) {
  return (
    <div className="flex items-center gap-px rounded-[var(--radius-control)] border border-border-default overflow-hidden">
      <button
        onClick={() => onModeChange('simple')}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-[background-color,color] duration-[50ms]',
          mode === 'simple'
            ? 'bg-accent-soft text-text-primary font-medium'
            : 'text-text-muted hover:text-text-secondary',
        )}
      >
        <LayoutGrid className="h-2.5 w-2.5" />
        Simple
      </button>
      <button
        onClick={() => onModeChange('standard')}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-[background-color,color] duration-[50ms]',
          mode === 'standard'
            ? 'bg-accent-soft text-text-primary font-medium'
            : 'text-text-muted hover:text-text-secondary',
        )}
      >
        <Sliders className="h-2.5 w-2.5" />
        Standard
      </button>
    </div>
  )
}
