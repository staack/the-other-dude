import { cn } from '@/lib/utils'

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-md bg-elevated bg-shimmer bg-shimmer relative overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}
