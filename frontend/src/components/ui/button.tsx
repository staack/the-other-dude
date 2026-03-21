import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,border-color,color] duration-[50ms] ease-linear focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:pointer-events-none disabled:text-text-muted disabled:border-border-subtle',
  {
    variants: {
      variant: {
        default: 'bg-accent text-background active:brightness-90 rounded-[var(--radius-control)]',
        solid: 'bg-accent text-background active:brightness-90 rounded-[var(--radius-control)]',
        destructive: 'bg-error/15 text-error hover:bg-error/20 active:bg-error/25 rounded-[var(--radius-control)]',
        outline:
          'border border-border-default bg-transparent text-text-secondary hover:border-accent active:bg-elevated rounded-[var(--radius-control)]',
        secondary: 'bg-elevated text-text-secondary hover:text-text-primary active:brightness-95 rounded-[var(--radius-control)]',
        ghost: 'text-text-secondary hover:bg-elevated hover:text-text-primary active:bg-elevated rounded-[var(--radius-control)]',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 text-xs',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-9 px-4 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
