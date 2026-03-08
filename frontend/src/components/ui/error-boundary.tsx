import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import { AlertTriangle, Search, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── ErrorBoundary (class component required for componentDidCatch) ──────────

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />
    }
    return this.props.children
  }
}

// ─── ErrorFallback (500 page) ────────────────────────────────────────────────

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error | null
  onReset: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-4">
      <AlertTriangle className="h-16 w-16 text-error mb-6" strokeWidth={1.5} />
      <h1 className="text-2xl font-semibold text-text-primary mb-2">
        Something went wrong
      </h1>
      <p className="text-sm text-text-secondary mb-8 text-center max-w-md">
        An unexpected error occurred. Try refreshing the page. If this keeps happening, contact your administrator.
      </p>

      {import.meta.env.DEV && error && (
        <div className="w-full max-w-lg mb-8">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors mb-2"
          >
            {showDetails ? 'Hide' : 'Show'} error details
          </button>
          {showDetails && (
            <div className="bg-elevated rounded-lg p-4 font-mono text-xs text-text-secondary overflow-auto max-h-64">
              <p className="text-error mb-2">{error.message}</p>
              {error.stack && (
                <pre className="whitespace-pre-wrap text-text-muted">
                  {error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <Button variant="default" onClick={onReset}>
        Try Again
      </Button>
      <a
        href="/"
        className="mt-4 text-sm text-accent hover:underline transition-colors"
      >
        Back to Dashboard
      </a>
    </div>
  )
}

// ─── NotFoundPage (404 page) ─────────────────────────────────────────────────

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-4">
      <Search className="h-16 w-16 text-text-muted mb-6" strokeWidth={1.5} />
      <p className="text-8xl font-bold text-text-muted mb-4">404</p>
      <h1 className="text-2xl font-semibold text-text-primary mb-2">
        Page not found
      </h1>
      <p className="text-sm text-text-secondary mb-8 text-center max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button variant="default" asChild>
        <a href="/">Back to Dashboard</a>
      </Button>
    </div>
  )
}

// ─── NetworkErrorPage ────────────────────────────────────────────────────────

export function NetworkErrorPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-4">
      <WifiOff className="h-16 w-16 text-warning mb-6" strokeWidth={1.5} />
      <h1 className="text-2xl font-semibold text-text-primary mb-2">
        Connection lost
      </h1>
      <p className="text-sm text-text-secondary mb-8 text-center max-w-md">
        Unable to reach the server. Check your connection and try again.
      </p>
      <Button variant="default" onClick={() => window.location.reload()}>
        Retry
      </Button>
    </div>
  )
}
