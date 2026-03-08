/**
 * ChangePreviewModal — Preview pending config changes before execution.
 *
 * Standard Apply mode: numbered list of human-readable change descriptions.
 * Safe Apply (with auto-revert) mode: generated RSC script in a monospace code block.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Zap, ShieldCheck } from 'lucide-react'
import type { ApplyMode, ConfigChange } from '@/lib/configPanelTypes'
import { describeChanges, generateRscScript } from '@/lib/configPanelTypes'

interface ChangePreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: ConfigChange[]
  applyMode: ApplyMode
  onConfirm: () => void
  isApplying: boolean
}

const WARNINGS: Record<ApplyMode, string> = {
  quick: 'These changes will be applied immediately without rollback capability.',
  safe: 'This RSC script will be executed on the device.',
}

export function ChangePreviewModal({
  open,
  onOpenChange,
  changes,
  applyMode,
  onConfirm,
  isApplying,
}: ChangePreviewModalProps) {
  const changeCount = changes.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review Changes
            {applyMode === 'quick' ? (
              <Badge className="gap-1 bg-accent/20 text-accent border-accent/40">
                <Zap className="h-3 w-3" />
                Standard
              </Badge>
            ) : (
              <Badge className="gap-1 bg-accent/20 text-accent border-accent/40">
                <ShieldCheck className="h-3 w-3" />
                Safe (auto-revert)
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {changeCount} change{changeCount !== 1 ? 's' : ''} pending
          </DialogDescription>
        </DialogHeader>

        {/* Warning banner */}
        <div className="flex items-start gap-2 bg-warning/10 text-warning border border-warning/30 rounded-lg p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{WARNINGS[applyMode]}</span>
        </div>

        {/* Change details */}
        <div className="max-h-72 overflow-y-auto">
          {applyMode === 'quick' ? (
            <QuickPreview changes={changes} />
          ) : (
            <SafePreview changes={changes} />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isApplying}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isApplying || changeCount === 0}
          >
            {isApplying
              ? 'Applying...'
              : `Apply ${changeCount} Change${changeCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QuickPreview({ changes }: { changes: ConfigChange[] }) {
  const descriptions = describeChanges(changes)
  return (
    <ol className="space-y-1.5 text-sm text-text-primary">
      {descriptions.map((desc, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-text-secondary font-mono shrink-0 w-5 text-right">
            {i + 1}.
          </span>
          <span>{changes[i].description}</span>
        </li>
      ))}
    </ol>
  )
}

function SafePreview({ changes }: { changes: ConfigChange[] }) {
  const script = generateRscScript(changes)
  return (
    <pre className="font-mono text-sm bg-elevated rounded-lg p-4 overflow-x-auto text-text-primary whitespace-pre-wrap break-all">
      {script}
    </pre>
  )
}
