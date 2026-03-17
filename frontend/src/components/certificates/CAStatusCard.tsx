/**
 * CAStatusCard -- Shows the CA initialization state or active CA details.
 *
 * When NO CA exists: centered prompt with "Initialize CA" button.
 * When CA exists: card with fingerprint, validity, download, and status badge.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield,
  ShieldCheck,
  Download,
  Copy,
  CheckCircle,
  Loader2,
} from 'lucide-react'
import { certificatesApi, type CAResponse } from '@/lib/certificatesApi'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

interface CAStatusCardProps {
  ca: CAResponse | null
  canWrite: boolean
  tenantId: string
}

export function CAStatusCard({ ca, canWrite: writable, tenantId }: CAStatusCardProps) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const initMutation = useMutation({
    mutationFn: () => certificatesApi.createCA(undefined, undefined, tenantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ca'] })
      toast({ title: 'Certificate Authority initialized' })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({
        title: err?.response?.data?.detail || 'Failed to initialize CA',
        variant: 'destructive',
      })
    },
  })

  const handleDownloadPEM = async () => {
    try {
      const pem = await certificatesApi.getCACertPEM(tenantId)
      const blob = new Blob([pem], { type: 'application/x-pem-file' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'portal-ca.pem'
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'CA certificate downloaded' })
    } catch {
      toast({ title: 'Failed to download certificate', variant: 'destructive' })
    }
  }

  const copyFingerprint = (fp: string) => {
    navigator.clipboard.writeText(fp)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast({ title: 'Fingerprint copied' })
  }

  const isExpired = ca
    ? new Date(ca.not_valid_after) < new Date()
    : false

  // ── No CA state ──
  if (!ca) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="rounded-lg border border-border bg-surface p-8 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
            <Shield className="h-8 w-8 text-accent" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">
              No Certificate Authority
            </h2>
            <p className="text-sm text-text-secondary mt-2 max-w-sm mx-auto">
              Initialize a Certificate Authority to secure device API connections
              with proper TLS certificates.
            </p>
          </div>
          {writable && (
            <Button
              onClick={() => initMutation.mutate()}
              disabled={initMutation.isPending}
              className="w-full"
              size="lg"
            >
              {initMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Initializing...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Initialize CA
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── CA exists state ──
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface p-6 space-y-4',
        isExpired ? 'border-error/40' : 'border-success/30',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              isExpired ? 'bg-error/10' : 'bg-success/10',
            )}
          >
            <ShieldCheck
              className={cn(
                'h-5 w-5',
                isExpired ? 'text-error' : 'text-success',
              )}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {ca.common_name}
            </h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border mt-0.5',
                isExpired
                  ? 'bg-error/20 text-error border-error/40'
                  : 'bg-success/20 text-success border-success/40',
              )}
            >
              {isExpired ? 'Expired' : 'Active'}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadPEM}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download CA Cert
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        {/* Fingerprint */}
        <div className="space-y-1">
          <span className="text-xs text-text-muted uppercase tracking-wider">
            SHA-256 Fingerprint
          </span>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-text-secondary truncate max-w-[280px]">
              {ca.fingerprint_sha256}
            </code>
            <button
              onClick={() => copyFingerprint(ca.fingerprint_sha256)}
              className="text-text-muted hover:text-text-secondary flex-shrink-0"
              title="Copy fingerprint"
            >
              {copied ? (
                <CheckCircle className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Serial */}
        <div className="space-y-1">
          <span className="text-xs text-text-muted uppercase tracking-wider">
            Serial Number
          </span>
          <code className="text-xs font-mono text-text-secondary block">
            {ca.serial_number}
          </code>
        </div>

        {/* Valid From */}
        <div className="space-y-1">
          <span className="text-xs text-text-muted uppercase tracking-wider">
            Valid From
          </span>
          <span className="text-text-primary block">
            {new Date(ca.not_valid_before).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>

        {/* Valid Until */}
        <div className="space-y-1">
          <span className="text-xs text-text-muted uppercase tracking-wider">
            Valid Until
          </span>
          <span
            className={cn(
              'block',
              isExpired ? 'text-error font-medium' : 'text-text-primary',
            )}
          >
            {new Date(ca.not_valid_after).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>
    </div>
  )
}
