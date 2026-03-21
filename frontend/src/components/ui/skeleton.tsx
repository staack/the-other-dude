// Compatibility shim — returns null. Remove once all imports are cleaned up.
export function Skeleton() {
  return null
}

// Use this for panels where loading delay is noticeable
export function LoadingText({ text = 'Loading\u2026' }: { text?: string }) {
  return <span className="text-[9px] text-text-muted">{text}</span>
}
