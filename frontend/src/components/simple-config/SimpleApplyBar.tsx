/**
 * SimpleApplyBar -- A sticky bottom bar showing the pending change count
 * and a "Review & Apply" button for Simple mode category panels.
 */

import { Button } from '@/components/ui/button'

interface SimpleApplyBarProps {
  pendingCount: number
  isApplying: boolean
  onReviewClick: () => void
}

export function SimpleApplyBar({
  pendingCount,
  isApplying,
  onReviewClick,
}: SimpleApplyBarProps) {
  if (pendingCount === 0) return null

  return (
    <div className="flex items-center justify-between pt-4 border-t border-border">
      <span className="text-xs text-text-muted">
        {pendingCount} pending change{pendingCount !== 1 ? 's' : ''}
      </span>
      <Button
        size="sm"
        disabled={pendingCount === 0 || isApplying}
        onClick={onReviewClick}
      >
        {isApplying ? 'Applying...' : 'Review & Apply'}
      </Button>
    </div>
  )
}
