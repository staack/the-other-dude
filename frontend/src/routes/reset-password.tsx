import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api'
import { RugLogo } from '@/components/brand/RugLogo'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) ?? '',
  }),
})

function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' })
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordsMatch = password === confirmPassword
  const passwordLongEnough = password.length >= 8

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || !confirmPassword || !passwordsMatch || !passwordLongEnough) return
    setSubmitting(true)
    setError(null)
    try {
      await authApi.resetPassword(token, password)
      setSuccess(true)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Something went wrong. Please try again.'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-lg border border-border bg-surface/50 p-6 space-y-4">
            <p className="text-sm text-error">Invalid reset link. No token provided.</p>
            <Link to="/login" className="block text-sm text-accent hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <RugLogo size={48} />
          </div>
          <h1 className="text-lg font-semibold text-text-primary">Set New Password</h1>
          <p className="text-xs text-text-muted mt-1">Choose a strong password</p>
        </div>

        <div className="rounded-lg border border-border bg-surface/50 p-6">
          {success ? (
            <div className="space-y-4">
              <div className="rounded-md bg-success/10 border border-success/30 px-3 py-3">
                <p className="text-sm text-success">
                  Password has been reset successfully.
                </p>
              </div>
              <div className="rounded-md bg-accent/10 border border-accent/30 px-3 py-3">
                <p className="text-sm text-text-secondary">
                  When you sign in, you will be guided through a one-time security upgrade
                  to zero-knowledge authentication. Your password will never be stored on
                  the server.
                </p>
              </div>
              <Link
                to="/login"
                className="block text-center text-sm text-accent hover:underline"
              >
                Go to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  autoFocus
                  required
                  minLength={8}
                />
                {password && !passwordLongEnough && (
                  <p className="text-xs text-error">Must be at least 8 characters</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                {confirmPassword && !passwordsMatch && (
                  <p className="text-xs text-error">Passwords do not match</p>
                )}
              </div>

              {error && (
                <div className="rounded-md bg-error/10 border border-error/30 px-3 py-2">
                  <p className="text-xs text-error">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={
                  submitting || !password || !confirmPassword || !passwordsMatch || !passwordLongEnough
                }
              >
                {submitting ? 'Resetting...' : 'Reset Password'}
              </Button>

              <Link
                to="/login"
                className="block text-center text-sm text-text-muted hover:text-text-primary"
              >
                Back to Sign In
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
