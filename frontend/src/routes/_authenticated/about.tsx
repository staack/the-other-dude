import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RugLogo } from '@/components/brand/RugLogo'
import { APP_VERSION } from '@/lib/version'
import { AnsiNfoModal } from '@/components/about/AnsiNfoModal'
import { activateLicense, getLicenseStatus, removeLicense } from '@/lib/settingsApi'

export const Route = createFileRoute('/_authenticated/about')({
  component: AboutPage,
})

function AboutPage() {
  const [showNfo, setShowNfo] = useState(false)
  const { data: license } = useQuery({ queryKey: ['license-status'], queryFn: getLicenseStatus })
  const queryClient = useQueryClient()
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseError, setLicenseError] = useState<string | null>(null)

  const activate = useMutation({
    mutationFn: activateLicense,
    onSuccess: () => {
      setLicenseKey('')
      setLicenseError(null)
      queryClient.invalidateQueries({ queryKey: ['license-status'] })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setLicenseError(detail || 'That key could not be verified.')
    },
  })

  const deactivate = useMutation({
    mutationFn: removeLicense,
    onSuccess: () => {
      setLicenseError(null)
      queryClient.invalidateQueries({ queryKey: ['license-status'] })
    },
  })

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <RugLogo size={64} />
        <h1 className="text-2xl font-bold text-text-primary">TOD - The Other Dude</h1>
        <p className="text-text-secondary">
          MikroTik fleet management platform
        </p>
        <span className="inline-block px-3 py-1 text-xs font-mono font-medium text-accent bg-accent-soft rounded-full">
          {APP_VERSION}
        </span>
      </div>

      {/* License */}
      {license && (
        <div className="rounded-lg border border-border bg-panel p-5 space-y-2">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            License
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">
              {license.tier === 'commercial' ? 'Commercial License' : 'BSL 1.1 — Free Tier'}
            </span>
            <span className={`text-sm font-mono ${license.over_limit ? 'text-error' : 'text-text-secondary'}`}>
              {license.unlimited
                ? `${license.actual_devices.toLocaleString()} devices · unlimited`
                : `${license.actual_devices} / ${license.licensed_devices} devices`}
            </span>
          </div>
          {license.licensee && (
            <p className="text-xs text-text-secondary">
              Licensed to <span className="text-text-primary">{license.licensee}</span>
            </p>
          )}
          {license.key_invalid && (
            <p className="text-xs text-error">
              The stored license key could not be verified. Paste it again below.
            </p>
          )}
          {license.over_limit && (
            <p className="text-xs text-error">
              Device count exceeds licensed limit. A commercial license is required.
            </p>
          )}

          {license.tier === 'commercial' && license.licensee ? (
            <button
              type="button"
              onClick={() => deactivate.mutate()}
              disabled={deactivate.isPending}
              className="text-xs text-text-secondary underline hover:text-text-primary disabled:opacity-50"
            >
              {deactivate.isPending ? 'Removing…' : 'Remove license key'}
            </button>
          ) : (
            <div className="space-y-2 pt-1">
              <label htmlFor="license-key" className="block text-xs text-text-secondary">
                Have a commercial license key? Paste it here.
              </label>
              <div className="flex gap-2">
                <input
                  id="license-key"
                  type="text"
                  value={licenseKey}
                  onChange={(e) => {
                    setLicenseKey(e.target.value)
                    setLicenseError(null)
                  }}
                  placeholder="TOD1-…"
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => activate.mutate(licenseKey.trim())}
                  disabled={!licenseKey.trim() || activate.isPending}
                  className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-50"
                >
                  {activate.isPending ? 'Checking…' : 'Activate'}
                </button>
              </div>
              {licenseError && <p className="text-xs text-error">{licenseError}</p>}
              <p className="text-xs text-text-muted">
                Verified on this machine. Nothing is sent anywhere.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Features summary */}
      <div className="rounded-lg border border-border bg-panel p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Platform
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm text-text-secondary">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Multi-tenant with RLS
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            RouterOS binary API
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Real-time monitoring
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Safe config push
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Certificate authority
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            WireGuard VPN
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center space-y-2">
        <p className="text-xs text-text-muted">
          Not affiliated with or endorsed by MikroTik (SIA Mikrotikls)
        </p>
        <button
          onClick={() => setShowNfo(true)}
          className="text-[10px] font-mono text-text-muted/40 hover:text-accent transition-colors cursor-pointer"
        >
          ANSI
        </button>
      </div>

      <AnsiNfoModal open={showNfo} onOpenChange={setShowNfo} />
    </div>
  )
}
