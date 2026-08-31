/**
 * SafetyToggle -- Toggle between applying immediately and reviewing first.
 *
 * Apply Now:      changes are sent as soon as you confirm.
 * Review Changes: shows the equivalent RSC script for inspection before the
 *                 same commands are sent.
 *
 * NOTE: neither mode performs an automatic revert. The config editor executes
 * changes over the binary API and has no rollback mechanism (see
 * useConfigPanel.ts). This control used to be labelled "Safe Apply (with
 * auto-revert)", which promised a safety net that did not exist. Automatic
 * rollback IS implemented for config restore and template push, via RouterOS
 * safe mode -- see backend/app/services/safe_mode.py. If that is ever wired
 * into the config editor, this label can change back.
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
  quick: 'Changes are applied as soon as you confirm. There is no automatic rollback.',
  safe: 'Shows the equivalent RSC script to review before applying. There is still no automatic rollback -- the safety is the review step.',
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
          Apply Now
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
          Review Changes
        </Button>
      </div>
      <p className="text-xs text-text-secondary">{MODE_DESCRIPTIONS[mode]}</p>
    </div>
  )
}
