import { cn } from '@/lib/utils'

export interface TimeRangeSelectorProps {
  value: string // '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | 'custom'
  onChange: (range: string) => void
  customStart?: string // ISO string, only used when value === 'custom'
  customEnd?: string // ISO string, only used when value === 'custom'
  onCustomRangeChange?: (start: string, end: string) => void
}

const PRESETS = ['1h', '6h', '24h', '7d', '30d', '90d'] as const

/**
 * Convert an ISO string to the format required by datetime-local inputs (YYYY-MM-DDTHH:MM).
 */
function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  // datetime-local inputs accept YYYY-MM-DDTHH:MM (no seconds/Z)
  return iso.slice(0, 16)
}

/**
 * Returns start/end ISO strings for a given preset range or custom range.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getTimeRange(
  range: string,
  customStart?: string,
  customEnd?: string,
): { start: string; end: string } {
  if (range === 'custom' && customStart && customEnd) {
    return { start: customStart, end: customEnd }
  }

  const end = new Date()
  const start = new Date(end)

  switch (range) {
    case '1h':
      start.setHours(start.getHours() - 1)
      break
    case '6h':
      start.setHours(start.getHours() - 6)
      break
    case '24h':
      start.setHours(start.getHours() - 24)
      break
    case '7d':
      start.setDate(start.getDate() - 7)
      break
    case '30d':
      start.setDate(start.getDate() - 30)
      break
    case '90d':
      start.setDate(start.getDate() - 90)
      break
    default:
      start.setHours(start.getHours() - 6)
  }

  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Returns refetchInterval (ms) for short ranges, false for longer ones.
 * Per user decision: 1h and 6h auto-refresh every 60 seconds.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldAutoRefresh(range: string): number | false {
  if (range === '1h' || range === '6h') return 60_000
  return false
}

export function TimeRangeSelector({
  value,
  onChange,
  customStart = '',
  customEnd = '',
  onCustomRangeChange,
}: TimeRangeSelectorProps) {
  const handleCustomStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = e.target.value ? new Date(e.target.value).toISOString() : ''
    onChange('custom')
    onCustomRangeChange?.(newStart, customEnd)
  }

  const handleCustomEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEnd = e.target.value ? new Date(e.target.value).toISOString() : ''
    onChange('custom')
    onCustomRangeChange?.(customStart, newEnd)
  }

  return (
    <div className="space-y-2">
      {/* Preset buttons row */}
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => onChange(preset)}
            className={cn(
              'px-2.5 py-1 text-xs rounded border transition-colors',
              value === preset
                ? 'bg-elevated border-border-bright text-text-primary'
                : 'bg-transparent border-border/50 text-text-primary/40 hover:text-text-primary/60 hover:border-border',
            )}
          >
            {preset}
          </button>
        ))}
        <button
          onClick={() => onChange('custom')}
          className={cn(
            'px-2.5 py-1 text-xs rounded border transition-colors',
            value === 'custom'
              ? 'bg-elevated border-border-bright text-text-primary'
              : 'bg-transparent border-border/50 text-text-primary/40 hover:text-text-primary/60 hover:border-border',
          )}
        >
          Custom
        </button>
      </div>

      {/* Custom date picker inputs */}
      {value === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-primary/40">Start</span>
            <input
              type="datetime-local"
              value={toDatetimeLocal(customStart)}
              onChange={handleCustomStartChange}
              className={cn(
                'text-xs rounded border border-border bg-elevated/50 text-text-primary px-2 py-1',
                '[color-scheme:dark]',
              )}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-primary/40">End</span>
            <input
              type="datetime-local"
              value={toDatetimeLocal(customEnd)}
              onChange={handleCustomEndChange}
              className={cn(
                'text-xs rounded border border-border bg-elevated/50 text-text-primary px-2 py-1',
                '[color-scheme:dark]',
              )}
            />
          </div>
        </div>
      )}
    </div>
  )
}
