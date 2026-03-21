import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-8 w-full rounded-[var(--radius-control)] border border-border-default bg-panel px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted transition-[border-color] duration-[50ms] ease-linear file:border-0 file:bg-transparent file:text-xs file:font-medium focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-text-muted disabled:border-border-subtle',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
