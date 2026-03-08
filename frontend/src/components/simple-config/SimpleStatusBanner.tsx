/**
 * SimpleStatusBanner -- A horizontal bar showing key current-config values
 * at a glance at the top of each Simple mode category panel.
 */

interface SimpleStatusBannerProps {
  items: { label: string; value: string }[]
  isLoading?: boolean
}

export function SimpleStatusBanner({ items, isLoading }: SimpleStatusBannerProps) {
  return (
    <div className="rounded-lg border border-border bg-elevated/50 px-4 py-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex flex-col">
            <span className="text-xs text-text-muted">{item.label}</span>
            {isLoading ? (
              <div className="h-5 w-24 mt-0.5 rounded bg-elevated animate-shimmer" />
            ) : (
              <span className="text-sm font-medium text-text-primary">
                {item.value || '\u2014'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
