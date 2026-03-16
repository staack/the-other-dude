import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SecretKeyInput } from '@/components/auth/SecretKeyInput'
import { SrpUpgradeDialog } from '@/components/auth/SrpUpgradeDialog'
import { RugLogo } from '@/components/brand/RugLogo'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const {
    login,
    srpLogin,
    isAuthenticated,
    isLoading,
    error,
    clearError,
    needsSecretKey,
    isDerivingKeys,
    clearNeedsSecretKey,
    isUpgrading,
    pendingUpgradeEmail,
    pendingUpgradePassword,
    completeUpgrade,
    cancelUpgrade,
  } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      void navigate({ to: '/' })
    }
  }, [isAuthenticated, isLoading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setSubmitting(true)
    try {
      if (needsSecretKey) {
        // SRP user providing Secret Key on new device
        await srpLogin(email, password, secretKey)
      } else {
        // Normal login -- will auto-redirect to SRP if user is SRP-enrolled
        await login(email, password)
      }
      // Don't navigate if SRP upgrade or Secret Key entry is needed
      const { isUpgrading: upgrading, needsSecretKey: needsKey } = useAuth.getState()
      if (!upgrading && !needsKey) {
        void navigate({ to: '/' })
      }
    } catch {
      // error handled by useAuth
    } finally {
      setSubmitting(false)
    }
  }

  const handleChange = () => {
    if (error) clearError()
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    // Only clear Secret Key state if email actually changed to a different address
    if (needsSecretKey && newEmail.toLowerCase() !== email.toLowerCase()) {
      clearNeedsSecretKey()
      setSecretKey('')
    }
    setEmail(newEmail)
    handleChange()
  }

  const buttonText = () => {
    if (isDerivingKeys) return 'Unlocking your vault...'
    if (submitting) return 'Signing in...'
    if (needsSecretKey) return 'Unlock'
    return 'Sign In'
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden" data-testid="login-page">
      {/* Decorative rug border accent */}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[400px] pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            90deg,
            #8B1A1A 0px, #8B1A1A 2px,
            transparent 2px, transparent 8px,
            #F5E6C8 8px, #F5E6C8 10px,
            transparent 10px, transparent 16px,
            #2A9D8F 16px, #2A9D8F 18px,
            transparent 18px, transparent 24px
          ),
          repeating-linear-gradient(
            0deg,
            #8B1A1A 0px, #8B1A1A 2px,
            transparent 2px, transparent 8px,
            #F5E6C8 8px, #F5E6C8 10px,
            transparent 10px, transparent 16px,
            #2A9D8F 16px, #2A9D8F 18px,
            transparent 18px, transparent 24px
          )`,
        }}
      />
      <div className="w-full max-w-sm relative z-10">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <RugLogo size={56} />
          </div>
          <h1 className="text-lg font-semibold text-text-primary">TOD - The Other Dude</h1>
          <p className="text-xs text-text-muted mt-1">MSP Fleet Management</p>
        </div>

        {/* Login card */}
        <div className="rounded-lg border border-border bg-surface p-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="admin@example.com"
                autoComplete="email"
                autoFocus
                required
                data-testid="input-email"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-text-muted hover:text-accent"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  handleChange()
                }}
                placeholder="--------"
                autoComplete="current-password"
                required
                data-testid="input-password"
              />
            </div>

            {/* Secret Key input -- shown when SRP user on new device */}
            {needsSecretKey && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="secret-key">Secret Key</Label>
                  <span
                    className="text-xs text-text-muted cursor-help"
                    title="Enter the Secret Key from your Emergency Kit. This key was generated when you set up zero-knowledge encryption."
                  >
                    From your Emergency Kit
                  </span>
                </div>
                <SecretKeyInput
                  value={secretKey}
                  onChange={(v) => {
                    setSecretKey(v)
                    handleChange()
                  }}
                  error={!!error}
                />
                <p className="text-xs text-text-muted">
                  This device does not have your Secret Key stored. Enter it from your Emergency
                  Kit to unlock your vault.
                </p>
                <details className="text-xs text-text-muted mt-1">
                  <summary className="cursor-pointer hover:text-accent">
                    Lost your Secret Key?
                  </summary>
                  <p className="mt-1.5 pl-3 border-l-2 border-border">
                    Use{' '}
                    <Link to="/forgot-password" className="text-accent hover:underline">
                      Forgot password
                    </Link>{' '}
                    to reset your account. You will set a new password and receive a new Secret Key.
                    Note: previously encrypted data may be inaccessible.
                  </p>
                </details>
              </div>
            )}

            {error && (
              <div className="rounded-md bg-error/10 border border-error/30 px-3 py-2" data-testid="login-error" role="alert">
                <p className="text-xs text-error">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              variant="solid"
              className="w-full"
              data-testid="button-sign-in"
              disabled={
                submitting ||
                isLoading ||
                isDerivingKeys ||
                !email ||
                !password ||
                (needsSecretKey && secretKey.replace(/[-\s]/g, '').length < 28)
              }
            >
              {buttonText()}
            </Button>
          </form>
        </div>

        {/* First-run hint (dev only) */}
        {import.meta.env.DEV && (
          <div className="text-center mt-4 px-2">
            <p className="text-xs text-text-muted">
              First time? Use the credentials from your <code className="text-text-secondary">.env</code> file
              (<code className="text-text-secondary">FIRST_ADMIN_EMAIL</code> / <code className="text-text-secondary">FIRST_ADMIN_PASSWORD</code>).
            </p>
          </div>
        )}

        {/* Legal links */}
        <div className="flex justify-center gap-4 mt-3">
          <Link to="/terms" className="text-xs text-text-muted hover:text-text-secondary">
            Terms of Service
          </Link>
          <Link to="/privacy" className="text-xs text-text-muted hover:text-text-secondary">
            Privacy Policy
          </Link>
        </div>
      </div>

      {/* SRP Upgrade Dialog for legacy bcrypt users */}
      {isUpgrading && pendingUpgradeEmail && pendingUpgradePassword && (
        <SrpUpgradeDialog
          open={isUpgrading}
          email={pendingUpgradeEmail}
          password={pendingUpgradePassword}
          onComplete={async () => {
            await completeUpgrade()
            void navigate({ to: '/' })
          }}
          onCancel={cancelUpgrade}
        />
      )}
    </div>
  )
}
