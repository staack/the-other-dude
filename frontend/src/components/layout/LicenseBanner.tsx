import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getLicenseStatus } from '@/lib/settingsApi'

const DISMISS_KEY = 'tod.licenseBannerDismissedAt'

// Re-surface a week after dismissal. Long enough not to nag, short enough
// that an over-limit install does not stay quietly out of compliance forever.
const DISMISS_DAYS = 7

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Private mode or blocked storage: show the banner rather than hide it.
    return false
  }
}

/**
 * Non-blocking notice shown when a deployment exceeds its licensed device
 * count. Nothing is gated or disabled — this exists so an over-limit install
 * finds out, since the licence status otherwise only appears on the About
 * page, which nobody visits.
 */
export function LicenseBanner() {
  const [dismissed, setDismissed] = useState(dismissedRecently)

  const { data: license } = useQuery({
    queryKey: ['license-status'],
    queryFn: getLicenseStatus,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (dismissed || !license?.over_limit) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Ignore storage failures; dismissal just won't persist.
    }
    setDismissed(true)
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-5 py-2 text-sm"
    >
      <span className="text-text-primary">
        <span className="font-mono">
          {license.actual_devices.toLocaleString()} of{' '}
          {license.licensed_devices.toLocaleString()}
        </span>{' '}
        licensed devices. A commercial license is required for production use above
        the limit.
      </span>
      <Link to="/about" className="underline hover:text-text-primary">
        Details
      </Link>
      <button
        type="button"
        onClick={dismiss}
        className="ml-auto text-text-secondary hover:text-text-primary"
        aria-label="Dismiss license notice"
      >
        Dismiss
      </button>
    </div>
  )
}
