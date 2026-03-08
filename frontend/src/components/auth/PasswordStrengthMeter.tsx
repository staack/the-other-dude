/**
 * PasswordStrengthMeter -- Visual password strength indicator using zxcvbn-ts.
 *
 * Evaluates password strength on every keystroke (zxcvbn is fast) and shows:
 * - Colored segmented progress bar (0-4 segments)
 * - Strength label: Very Weak, Weak, Fair, Strong, Very Strong
 * - Feedback suggestions when score < 3
 *
 * Also exports getPasswordScore() helper for form validation.
 */

import { useMemo } from 'react'
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common'
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en'
import { cn } from '@/lib/utils'

// Configure zxcvbn with language dictionaries
const options = {
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
  translations: zxcvbnEnPackage.translations,
}
zxcvbnOptions.setOptions(options)

// ---------------------------------------------------------------------------
// Exported helper for form validation
// ---------------------------------------------------------------------------

export function getPasswordScore(password: string): number {
  if (!password) return 0
  return zxcvbn(password).score
}

// ---------------------------------------------------------------------------
// Score configuration
// ---------------------------------------------------------------------------

const SCORE_CONFIG: Record<
  number,
  { label: string; color: string; barColor: string }
> = {
  0: {
    label: 'Very Weak',
    color: 'text-error',
    barColor: 'bg-error',
  },
  1: {
    label: 'Weak',
    color: 'text-orange-500',
    barColor: 'bg-orange-500',
  },
  2: {
    label: 'Fair',
    color: 'text-yellow-500',
    barColor: 'bg-yellow-500',
  },
  3: {
    label: 'Strong',
    color: 'text-green-500',
    barColor: 'bg-green-500',
  },
  4: {
    label: 'Very Strong',
    color: 'text-green-400',
    barColor: 'bg-green-400',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PasswordStrengthMeterProps {
  password: string
  className?: string
}

export function PasswordStrengthMeter({
  password,
  className,
}: PasswordStrengthMeterProps) {
  const result = useMemo(() => {
    if (!password) return null
    return zxcvbn(password)
  }, [password])

  if (!password || !result) return null

  const { score, feedback } = result
  const config = SCORE_CONFIG[score] ?? SCORE_CONFIG[0]!

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Segmented strength bar */}
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((segment) => (
          <div
            key={segment}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-200',
              segment <= score ? config.barColor : 'bg-elevated',
            )}
          />
        ))}
      </div>

      {/* Score label */}
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-medium', config.color)}>
          {config.label}
        </span>
      </div>

      {/* Feedback suggestions for weak passwords */}
      {score < 3 && (feedback.warning || feedback.suggestions.length > 0) && (
        <div className="text-xs text-text-muted space-y-0.5">
          {feedback.warning && (
            <p className="text-text-secondary">{feedback.warning}</p>
          )}
          {feedback.suggestions.map((suggestion, i) => (
            <p key={i}>{suggestion}</p>
          ))}
        </div>
      )}
    </div>
  )
}
