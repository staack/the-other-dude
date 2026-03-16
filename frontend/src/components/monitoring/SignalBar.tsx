import { cn } from '@/lib/utils'

interface SignalBarProps {
  signal: number
  label?: string
}

/**
 * Map dBm signal strength to a 0–100 quality percentage.
 * Range: -30 dBm (best) to -90 dBm (worst).
 */
function signalToPercent(signal: number): number {
  const clamped = Math.max(-90, Math.min(-30, signal))
  return ((clamped - -90) / (-30 - -90)) * 100
}

/**
 * Returns color class based on signal strength thresholds per plan:
 * - Green: -30 to -67 dBm
 * - Yellow: -67 to -70 dBm
 * - Red: below -70 dBm
 */
function signalColor(signal: number): string {
  if (signal >= -67) return 'bg-success'
  if (signal >= -70) return 'bg-warning'
  return 'bg-error'
}

function signalTextColor(signal: number): string {
  if (signal >= -67) return 'text-success'
  if (signal >= -70) return 'text-warning'
  return 'text-error'
}

export function SignalBar({ signal, label }: SignalBarProps) {
  const pct = signalToPercent(signal)
  const barColor = signalColor(signal)
  const textColor = signalTextColor(signal)

  return (
    <div className="space-y-1">
      {label && <div className="text-xs text-text-muted">{label}</div>}
      <div className="flex items-center gap-3">
        {/* Horizontal bar */}
        <div className="relative h-2 flex-1 rounded-full bg-elevated overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${pct}%` }}
            role="meter"
            aria-label={label || 'Signal strength'}
            aria-valuenow={signal ?? 0}
            aria-valuemin={-100}
            aria-valuemax={0}
          />
        </div>
        {/* dBm value */}
        <span className={cn('text-sm font-mono font-medium tabular-nums', textColor)}>
          {signal} dBm
        </span>
      </div>
    </div>
  )
}
