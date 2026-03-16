import * as React from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  color?: string | null
}

function Badge({ className, color, children, ...props }: BadgeProps) {
  const style = color ? { backgroundColor: color + '33', color, borderColor: color + '66' } : undefined
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium border',
        !color && 'border-border bg-elevated text-text-secondary',
        className,
      )}
      style={style}
      {...props}
    >
      {children}
    </span>
  )
}

export { Badge }
