import { Skeleton } from './skeleton'

/** Table-style skeleton with header + rows */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32 ml-auto" />
      </div>
      {/* Filter bar */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      {/* Table header */}
      <div className="flex gap-4 py-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-16 ml-auto" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20 ml-auto" />
        </div>
      ))}
    </div>
  )
}

/** Card grid skeleton */
export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Detail page skeleton (header + tabs + content) */
export function DetailPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-24 ml-auto" />
      </div>
      {/* Tabs */}
      <div className="flex gap-4 border-b border-border pb-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
      </div>
      {/* Content area */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
