import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api'
import { RugLogo } from '@/components/brand/RugLogo'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    setError(null)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <RugLogo size={48} />
          </div>
          <h1 className="text-lg font-semibold text-text-primary">Reset Password</h1>
          <p className="text-xs text-text-muted mt-1">
            Enter your email to receive a reset link.
            After resetting, you will set up zero-knowledge authentication.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-panel/50 p-6">
          {sent ? (
            <div className="space-y-4">
              <div className="rounded-md bg-success/10 border border-success/30 px-3 py-3">
                <p className="text-sm text-success">
                  If an account with that email exists, a password reset link has been sent.
                  Check your inbox.
                </p>
              </div>
              <Link
                to="/login"
                className="block text-center text-sm text-accent hover:underline"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder="admin@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              {error && (
                <div className="rounded-md bg-error/10 border border-error/30 px-3 py-2">
                  <p className="text-xs text-error">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !email}
              >
                {submitting ? 'Sending...' : 'Send Reset Link'}
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
