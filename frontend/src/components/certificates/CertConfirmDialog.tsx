/**
 * CertConfirmDialog -- Confirmation dialog for certificate operations.
 *
 * - Rotate: Standard confirmation with consequence text.
 * - Revoke: Type-to-confirm (must type hostname), destructive red styling.
 *
 * Uses the project's existing Dialog primitives (Radix react-dialog).
 */

import { useState, useEffect } from 'react'
import { AlertTriangle, RefreshCw, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface CertConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: 'rotate' | 'revoke'
  deviceHostname: string
  onConfirm: () => void
}

export function CertConfirmDialog({
  open,
  onOpenChange,
  action,
  deviceHostname,
  onConfirm,
}: CertConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  const isRevoke = action === 'revoke'
  const canConfirm = isRevoke ? confirmText === deviceHostname : true

  // Reset confirm text when dialog opens/closes or action changes
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirmText('')
    }
  }, [open, action])

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                isRevoke ? 'bg-error/10' : 'bg-amber-500/10'
              }`}
            >
              {isRevoke ? (
                <XCircle className="h-5 w-5 text-error" />
              ) : (
                <RefreshCw className="h-5 w-5 text-amber-500" />
              )}
            </div>
            <DialogTitle className="text-lg">
              {isRevoke ? 'Revoke Certificate' : 'Rotate Certificate'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {isRevoke
              ? `This will permanently revoke the certificate for ${deviceHostname}. The device will fall back to insecure TLS mode.`
              : `This will generate a new certificate for ${deviceHostname}. The old certificate will be superseded.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {/* Warning callout */}
          <div
            className={`flex items-start gap-3 rounded-md p-3 ${
              isRevoke
                ? 'bg-error/10 border border-error/30'
                : 'bg-amber-500/10 border border-amber-500/30'
            }`}
          >
            <AlertTriangle
              className={`h-4 w-4 mt-0.5 shrink-0 ${
                isRevoke ? 'text-error' : 'text-amber-500'
              }`}
            />
            <p className="text-xs text-text-secondary leading-relaxed">
              {isRevoke
                ? 'This action cannot be undone. The device will lose its verified TLS certificate and revert to self-signed mode until a new certificate is deployed.'
                : 'The current certificate will be marked as superseded. A new certificate will be signed and deployed to the device.'}
            </p>
          </div>

          {/* Type-to-confirm for revoke */}
          {isRevoke && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-hostname" className="text-sm">
                Type <span className="font-mono font-semibold text-text-primary">{deviceHostname}</span> to confirm
              </Label>
              <Input
                id="confirm-hostname"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={deviceHostname}
                autoComplete="off"
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isRevoke ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {isRevoke ? (
              <>
                <XCircle className="h-4 w-4 mr-1.5" />
                Revoke Certificate
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Rotate Certificate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
