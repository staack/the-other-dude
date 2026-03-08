import { cn } from '@/lib/utils'

interface ShortcutHintProps {
  keys: string // e.g., "g d" or "?" or "Cmd+K"
  className?: string
}

export function ShortcutHint({ keys, className }: ShortcutHintProps) {
  const parts = keys.split(/(\+| )/).filter(Boolean)
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {parts.map((part, i) =>
        part === '+' || part === ' ' ? (
          <span
            key={i}
            className="text-text-muted text-xs mx-0.5"
          >
            {part === '+' ? '+' : ''}
          </span>
        ) : (
          <kbd
            key={i}
            className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono font-medium bg-elevated border border-border rounded text-text-secondary"
          >
            {part}
          </kbd>
        ),
      )}
    </span>
  )
}
