import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { authApi } from '@/lib/api'
import { keyStore } from '@/lib/crypto/keyStore'
import { deriveKeysInWorker } from '@/lib/crypto/keys'
import { computeVerifier } from '@/lib/crypto/srp'
import { getErrorMessage } from '@/lib/errors'
import {
  PasswordStrengthMeter,
  getPasswordScore,
} from '@/components/auth/PasswordStrengthMeter'

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

export function ChangePasswordForm() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSrpUser = user?.auth_version === 2

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (getPasswordScore(newPassword) < 3) {
      setError('Password is too weak. Please choose a stronger password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password')
      return
    }

    setIsSubmitting(true)

    try {
      if (isSrpUser) {
        // SRP user: re-derive verifier with new password
        const email = user!.email
        const secretKeyBytes = await keyStore.getSecretKey(email)
        if (!secretKeyBytes) {
          setError('Secret Key not found on this device. Cannot change password.')
          setIsSubmitting(false)
          return
        }

        // Generate new salts for the new key derivation
        const pbkdf2Salt = crypto.getRandomValues(new Uint8Array(32))
        const hkdfSalt = crypto.getRandomValues(new Uint8Array(32))

        // Derive new keys with new password
        const { auk, srpX } = await deriveKeysInWorker({
          masterPassword: newPassword,
          secretKeyBytes,
          email,
          accountId: email,
          pbkdf2Salt,
          hkdfSalt,
        })

        // Compute new SRP verifier
        const srpSalt = crypto.getRandomValues(new Uint8Array(32))
        const srpSaltHex = toHex(srpSalt)
        const srpXHex = toHex(srpX)
        const verifierHex = computeVerifier(srpXHex)

        // Generate new RSA keypair and wrap with new AUK
        const keyPair = await crypto.subtle.generateKey(
          { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
          true,
          ['encrypt', 'decrypt'],
        )
        const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey)
        const privateKeyNonce = crypto.getRandomValues(new Uint8Array(12))
        const wrappedPrivateKey = await crypto.subtle.wrapKey('pkcs8', keyPair.privateKey, auk, { name: 'AES-GCM', iv: privateKeyNonce })

        // Generate and wrap new vault key
        const vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
        const vaultKeyNonce = crypto.getRandomValues(new Uint8Array(12))
        const wrappedVaultKey = await crypto.subtle.wrapKey('raw', vaultKey, auk, { name: 'AES-GCM', iv: vaultKeyNonce })

        await authApi.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
          new_srp_salt: srpSaltHex,
          new_srp_verifier: verifierHex,
          encrypted_private_key: toBase64(wrappedPrivateKey),
          private_key_nonce: toBase64(privateKeyNonce),
          encrypted_vault_key: toBase64(wrappedVaultKey),
          vault_key_nonce: toBase64(vaultKeyNonce),
          public_key: toBase64(publicKeyBuffer),
          pbkdf2_salt: toBase64(pbkdf2Salt),
          hkdf_salt: toBase64(hkdfSalt),
        })
      } else {
        // Legacy bcrypt user
        await authApi.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
        })
      }

      toast.success('Password changed. Please sign in again.')
      await logout()
      void navigate({ to: '/login' })
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to change password'))
    } finally {
      setIsSubmitting(false)
    }
  }, [currentPassword, newPassword, confirmPassword, isSrpUser, user, logout, navigate])

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current Password</Label>
        <Input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => { setCurrentPassword(e.target.value); setError(null) }}
          placeholder="Enter current password"
          autoComplete="current-password"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-password">New Password</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => { setNewPassword(e.target.value); setError(null) }}
          placeholder="Enter new password (min 8 characters)"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <PasswordStrengthMeter password={newPassword} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm New Password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setError(null) }}
          placeholder="Re-enter new password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      {isSrpUser && (
        <p className="text-xs text-text-muted">
          Your Secret Key will remain unchanged. Only your master password changes.
        </p>
      )}

      {error && (
        <div className="rounded-md bg-error/10 border border-error/30 px-3 py-2">
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword || (newPassword.length > 0 && getPasswordScore(newPassword) < 3)}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {isSrpUser ? 'Re-deriving keys...' : 'Changing password...'}
          </>
        ) : (
          <>
            <Lock className="mr-2 h-4 w-4" />
            Change Password
          </>
        )}
      </Button>
    </form>
  )
}
