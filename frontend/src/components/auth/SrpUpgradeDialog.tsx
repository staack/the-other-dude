/**
 * SRP Upgrade Dialog shown when a legacy bcrypt user logs in and needs
 * to register zero-knowledge SRP credentials.
 *
 * Flow:
 * 1. User sees explanation of what's happening
 * 2. Click "Upgrade Now" triggers client-side key generation
 * 3. Registration data sent to /auth/register-srp
 * 4. Emergency Kit dialog shown with Secret Key
 * 5. After acknowledging, completeUpgrade() logs in via SRP
 */

import { useState, useCallback } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { performRegistration, assertWebCryptoAvailable } from '@/lib/crypto/registration'
import { keyStore } from '@/lib/crypto/keyStore'
import { authApi } from '@/lib/api'
import { EmergencyKitDialog } from './EmergencyKitDialog'

interface SrpUpgradeDialogProps {
  open: boolean
  email: string
  password: string
  onComplete: () => Promise<void>
  onCancel: () => void
}

type UpgradeStep = 'explain' | 'generating' | 'emergency-kit'

export function SrpUpgradeDialog({
  open,
  email,
  password,
  onComplete,
  onCancel,
}: SrpUpgradeDialogProps) {
  const [step, setStep] = useState<UpgradeStep>('explain')
  const [secretKey, setSecretKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Check if Web Crypto is available (HTTPS or localhost required)
  const cryptoAvailable = typeof crypto !== 'undefined' && !!crypto.subtle

  const handleUpgrade = useCallback(async () => {
    setStep('generating')
    setError(null)

    try {
      // 1. Generate all cryptographic material client-side
      const result = await performRegistration(email, password)

      // 2. Send SRP registration to server (user is temp-authenticated)
      await authApi.registerSRP({
        ...result.srpRegistration,
        ...result.keyBundle,
      })

      // 3. Store Secret Key in IndexedDB for this device
      await keyStore.storeSecretKey(email, result.secretKeyRaw)

      // 4. Show Emergency Kit with Secret Key
      setSecretKey(result.secretKey)
      setStep('emergency-kit')
    } catch (err) {
      const msg = getErrorMessage(err, 'Security upgrade failed. Please try again.')
      setError(msg)
      setStep('explain')
      toast.error(msg)
    }
  }, [email, password])

  const handleEmergencyKitClose = useCallback(async () => {
    // After user acknowledges Emergency Kit, complete the upgrade
    try {
      await onComplete()
    } catch {
      toast.error('Login failed after upgrade. Please try signing in again.')
      onCancel()
    }
  }, [onComplete, onCancel])

  // Emergency Kit sub-dialog
  if (step === 'emergency-kit') {
    return (
      <EmergencyKitDialog
        open={true}
        onClose={() => void handleEmergencyKitClose()}
        secretKey={secretKey}
        email={email}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <ShieldCheck className="h-5 w-5 text-accent" />
            </div>
            <DialogTitle className="text-lg">Account Security Upgrade</DialogTitle>
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            We're upgrading your account security so your password is never stored on
            our servers. This is a one-time process.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          {step === 'generating' ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <p className="text-sm text-text-secondary">
                Generating encryption keys...
              </p>
              <p className="text-xs text-text-muted">
                This may take a moment while we derive your security credentials.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md bg-surface-secondary p-4 text-sm text-text-secondary leading-relaxed space-y-3">
                <p>
                  <strong>What happens:</strong>
                </p>
                <ul className="list-disc pl-4 space-y-1.5">
                  <li>Your encryption keys are generated locally in your browser</li>
                  <li>A Secret Key is created that only you will have</li>
                  <li>Your password is never sent to or stored on the server</li>
                  <li>You will receive an Emergency Kit to save your Secret Key</li>
                </ul>
              </div>

              {!cryptoAvailable && (
                <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2">
                  <p className="text-xs text-warning font-medium">Secure connection required</p>
                  <p className="text-xs text-text-secondary mt-1">
                    Encryption features require HTTPS or localhost. Please access the
                    application via a secure connection to complete this upgrade.
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-md bg-error/10 border border-error/30 px-3 py-2">
                  <p className="text-xs text-error">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {step === 'explain' && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => void handleUpgrade()}
              disabled={!cryptoAvailable}
            >
              Upgrade Now
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
