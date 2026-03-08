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
    <div className="flex items-center gap-1 rounded-lg border border-border bg-elevated/50 p-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onModeChange('simple')}
        className={cn(
          'gap-1.5 h-7 px-2.5 text-xs',
          mode === 'simple' && 'bg-accent/20 text-accent',
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Simple
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onModeChange('standard')}
        className={cn(
          'gap-1.5 h-7 px-2.5 text-xs',
          mode === 'standard' && 'bg-accent/20 text-accent',
        )}
      >
        <Sliders className="h-3.5 w-3.5" />
        Standard
      </Button>
    </div>
  )
}
