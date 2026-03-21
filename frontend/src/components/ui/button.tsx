import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[hsl(var(--accent-soft))] text-accent hover:bg-accent/20',
        solid: 'bg-accent text-white hover:bg-accent',
        destructive: 'bg-error/15 text-error hover:bg-error/20',
        outline:
          'border border-border bg-transparent text-text-secondary hover:bg-elevated hover:text-text-primary',
        secondary: 'bg-elevated text-text-secondary hover:text-text-primary',
        ghost: 'text-text-secondary hover:bg-elevated hover:text-text-primary',
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
