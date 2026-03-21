/**
 * DeviceCertTable -- Table of device certificates with status badges,
 * action dropdown (deploy/rotate/revoke), toolbar with Sign & Deploy / Bulk Deploy buttons.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck,
  Plus,
  Layers,
  MoreHorizontal,
  Upload,
  RefreshCw,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  certificatesApi,
  type DeviceCertResponse,
} from '@/lib/certificatesApi'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { DeviceLink } from '@/components/ui/device-link'
import { TableSkeleton } from '@/components/ui/page-skeleton'
import { DeployCertDialog } from './DeployCertDialog'
import { BulkDeployDialog } from './BulkDeployDialog'
import { CertConfirmDialog } from './CertConfirmDialog'

// ---------------------------------------------------------------------------
// Status badge config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon?: React.FC<{ className?: string }> }
> = {
  issued: {
    label: 'Issued',
    className: 'bg-info/20 text-info border-info/40',
  },
  deploying: {
    label: 'Deploying...',
    className: 'bg-amber-500/20 text-amber-500 border-amber-500/40',
    icon: Loader2,
  },
  deployed: {
    label: 'Deployed',
    className: 'bg-success/20 text-success border-success/40',
  },
  expiring: {
    label: 'Expiring Soon',
    className: 'bg-warning/20 text-warning border-warning/40',
  },
  expired: {
    label: 'Expired',
    className: 'bg-error/20 text-error border-error/40',
  },
  revoked: {
    label: 'Revoked',
    className: 'bg-text-muted/20 text-text-muted border-text-muted/40',
  },
  superseded: {
    label: 'Superseded',
    className: 'bg-text-muted/20 text-text-muted border-text-muted/40',
  },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.issued
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border',
        config.className,
      )}
    >
      {Icon && <Icon className="h-3 w-3 animate-spin" />}
      {config.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeviceCertTableProps {
  certs: DeviceCertResponse[]
  loading: boolean
  caExists: boolean
  canWrite: boolean
  tenantId: string
}

export function DeviceCertTable({
  certs,
  loading,
  caExists,
  canWrite: writable,
  tenantId,
}: DeviceCertTableProps) {
  const queryClient = useQueryClient()
  const [showDeployDialog, setShowDeployDialog] = useState(false)
  const [showBulkDialog, setShowBulkDialog] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    action: 'rotate' | 'revoke'
    certId: string
    hostname: string
  } | null>(null)

  // ── Mutations ──

  const deployMutation = useMutation({
    mutationFn: (certId: string) => certificatesApi.deployCert(certId, tenantId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['deviceCerts'] })
      if (result.success) {
        toast({ title: 'Certificate deployed successfully' })
      } else {
        toast({ title: result.error ?? 'Deployment failed', variant: 'destructive' })
      }
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({
        title: err?.response?.data?.detail || 'Failed to deploy certificate',
        variant: 'destructive',
      })
    },
  })

  const rotateMutation = useMutation({
    mutationFn: (certId: string) => certificatesApi.rotateCert(certId, tenantId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['deviceCerts'] })
      if (result.success) {
        toast({ title: 'Certificate rotated successfully' })
      } else {
        toast({ title: result.error ?? 'Rotation failed', variant: 'destructive' })
      }
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({
        title: err?.response?.data?.detail || 'Failed to rotate certificate',
        variant: 'destructive',
      })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (certId: string) => certificatesApi.revokeCert(certId, tenantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deviceCerts'] })
      toast({ title: 'Certificate revoked' })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } }
      toast({
        title: err?.response?.data?.detail || 'Failed to revoke certificate',
        variant: 'destructive',
      })
    },
  })

  // ── Filtering ──
  // By default hide superseded certs; show only latest per device
  const filteredCerts = showAll
    ? certs
    : certs.filter((c) => c.status !== 'superseded')

  const isExpiringSoon = (dateStr: string) => {
    const expiry = new Date(dateStr)
    const now = new Date()
    const daysLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return daysLeft <= 30
  }

  if (loading) {
    return <TableSkeleton />
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-secondary">
          Device Certificates
        </h2>
        <div className="flex items-center gap-2">
          {/* Toggle superseded */}
          {certs.some((c) => c.status === 'superseded') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setShowAll(!showAll)}
              title={showAll ? 'Hide superseded' : 'Show all'}
            >
              {showAll ? (
                <><EyeOff className="h-3.5 w-3.5 mr-1" /> Hide Superseded</>
              ) : (
                <><Eye className="h-3.5 w-3.5 mr-1" /> Show All</>
              )}
            </Button>
          )}
          {writable && caExists && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBulkDialog(true)}
              >
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Bulk Deploy
              </Button>
              <Button size="sm" onClick={() => setShowDeployDialog(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Sign & Deploy
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Empty state */}
      {filteredCerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-accent/30 bg-accent/5 p-8 text-center space-y-3">
          <ShieldCheck className="h-10 w-10 text-accent mx-auto" />
          <h3 className="text-base font-semibold text-text-primary">
            No device certificates yet
          </h3>
          <p className="text-sm text-text-secondary max-w-md mx-auto">
            Deploy certificates to your devices to secure API connections with
            proper TLS.
          </p>
          {writable && caExists && (
            <Button
              size="sm"
              onClick={() => setShowDeployDialog(true)}
              className="mt-2"
            >
              <Plus className="h-4 w-4 mr-1" /> Deploy Your First Certificate
            </Button>
          )}
        </div>
      ) : (
        /* Table */
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-elevated/50 text-left">
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                  Device
                </th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                  Fingerprint
                </th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                  Valid Until
                </th>
                <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                  Deployed
                </th>
                {writable && (
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider text-right">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCerts.map((cert) => {
                const expired = new Date(cert.not_valid_after) < new Date()
                const expiringSoon =
                  !expired && isExpiringSoon(cert.not_valid_after)

                return (
                  <tr
                    key={cert.id}
                    className="hover:bg-elevated/30 transition-colors"
                  >
                    {/* Device */}
                    <td className="px-4 py-3">
                      <DeviceLink tenantId={tenantId} deviceId={cert.device_id}>
                        {cert.common_name}
                      </DeviceLink>
                    </td>

                    {/* Fingerprint */}
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-text-secondary">
                        {cert.fingerprint_sha256.slice(0, 24)}...
                      </code>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={cert.status} />
                    </td>

                    {/* Valid Until */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'text-sm',
                          expired || expiringSoon
                            ? 'text-error font-medium'
                            : 'text-text-secondary',
                        )}
                      >
                        {new Date(cert.not_valid_after).toLocaleDateString()}
                      </span>
                    </td>

                    {/* Deployed At */}
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-secondary">
                        {cert.deployed_at
                          ? new Date(cert.deployed_at).toLocaleDateString()
                          : '\u2014'}
                      </span>
                    </td>

                    {/* Actions */}
                    {writable && (
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" aria-label={`Actions for ${cert.common_name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            {cert.status === 'issued' && (
                              <DropdownMenuItem
                                onClick={() => deployMutation.mutate(cert.id)}
                                disabled={deployMutation.isPending}
                              >
                                <Upload className="h-3.5 w-3.5 mr-2" />
                                Deploy
                              </DropdownMenuItem>
                            )}
                            {(cert.status === 'deployed' || cert.status === 'expiring') && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setConfirmAction({
                                      action: 'rotate',
                                      certId: cert.id,
                                      hostname: cert.common_name,
                                    })
                                  }}
                                  disabled={rotateMutation.isPending}
                                >
                                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                  Rotate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setConfirmAction({
                                      action: 'revoke',
                                      certId: cert.id,
                                      hostname: cert.common_name,
                                    })
                                  }}
                                  disabled={revokeMutation.isPending}
                                  className="text-error focus:text-error"
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-2" />
                                  Revoke
                                </DropdownMenuItem>
                              </>
                            )}
                            {!['issued', 'deployed', 'expiring'].includes(cert.status) && (
                              <DropdownMenuItem disabled>
                                No actions available
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      {showDeployDialog && (
        <DeployCertDialog
          open={showDeployDialog}
          onClose={() => setShowDeployDialog(false)}
          tenantId={tenantId}
        />
      )}
      {showBulkDialog && (
        <BulkDeployDialog
          open={showBulkDialog}
          onClose={() => setShowBulkDialog(false)}
          tenantId={tenantId}
        />
      )}

      {/* Certificate action confirmation dialog */}
      <CertConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        action={confirmAction?.action ?? 'rotate'}
        deviceHostname={confirmAction?.hostname ?? ''}
        onConfirm={() => {
          if (confirmAction?.action === 'rotate') {
            rotateMutation.mutate(confirmAction.certId)
          } else if (confirmAction?.action === 'revoke') {
            revokeMutation.mutate(confirmAction.certId)
          }
          setConfirmAction(null)
        }}
      />
    </div>
  )
}
