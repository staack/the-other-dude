/**
 * SafetyToggle -- Toggle between Standard Apply and Safe Apply modes.
 *
 * Standard Apply: direct add/set/remove commands, no automatic rollback.
 * Safe Apply (with auto-revert): generates RSC script, executed via two-phase mechanism.
 */

import { Zap, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApplyMode } from '@/lib/configPanelTypes'

interface SafetyToggleProps {
  mode: ApplyMode
  onModeChange: (mode: ApplyMode) => void
}

const MODE_DESCRIPTIONS: Record<ApplyMode, string> = {
  quick: 'Changes applied directly. No automatic rollback.',
  safe: 'Changes applied via RSC script with automatic revert if not confirmed.',
}

export function SafetyToggle({ mode, onModeChange }: SafetyToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onModeChange('quick')}
          className={cn(
            'gap-1.5',
            mode === 'quick' &&
              'bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:text-accent',
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Standard Apply
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onModeChange('safe')}
          className={cn(
            'gap-1.5',
            mode === 'safe' &&
              'bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:text-accent',
          )}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Safe Apply (with auto-revert)
        </Button>
      </div>
      <p className="text-xs text-text-secondary">{MODE_DESCRIPTIONS[mode]}</p>
    </div>
  )
}
