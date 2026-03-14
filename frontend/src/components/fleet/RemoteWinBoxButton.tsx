import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, X, Loader2, RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import { remoteWinboxApi, type RemoteWinBoxSession } from '@/lib/api'

interface RemoteWinBoxButtonProps {
  tenantId: string
  deviceId: string
}

type State = 'idle' | 'requesting' | 'connecting' | 'active' | 'closing' | 'terminated' | 'failed'

export function RemoteWinBoxButton({ tenantId, deviceId }: RemoteWinBoxButtonProps) {
  const [state, setState] = useState<State>('idle')
  const [session, setSession] = useState<RemoteWinBoxSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [countdown, setCountdown] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queryClient = useQueryClient()

  // Check for existing active sessions on mount
  const { data: existingSessions } = useQuery({
    queryKey: ['remote-winbox-sessions', tenantId, deviceId],
    queryFn: () => remoteWinboxApi.list(tenantId, deviceId),
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (existingSessions && state === 'idle') {
      const active = existingSessions.find(
        (s) => s.status === 'active' || s.status === 'creating',
      )
      if (active) {
        setSession(active)
        setState(active.status === 'active' ? 'active' : 'connecting')
      }
    }
  }, [existingSessions, state])

  // Poll session status while connecting
  useEffect(() => {
    if (state !== 'connecting' || !session) return

    const poll = setInterval(async () => {
      try {
        const updated = await remoteWinboxApi.get(tenantId, deviceId, session.session_id)
        setSession(updated)
        if (updated.status === 'active') {
          setState('active')
        } else if (updated.status === 'failed') {
          setState('failed')
          setError('Session failed to provision')
        } else if (updated.status === 'terminated') {
          setState('terminated')
        }
      } catch {
        // ignore transient polling errors
      }
    }, 2000)

    pollRef.current = poll
    return () => clearInterval(poll)
  }, [state, session, tenantId, deviceId])

  // Countdown timer for session expiry
  useEffect(() => {
    if (state !== 'active' || !session?.expires_at) {
      setCountdown(null)
      return
    }

    const tick = () => {
      const remaining = Math.max(0, new Date(session.expires_at).getTime() - Date.now())
      if (remaining <= 0) {
        setCountdown('Expired')
        setState('terminated')
        return
      }
      const mins = Math.floor(remaining / 60000)
      const secs = Math.floor((remaining % 60000) / 1000)
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [state, session?.expires_at])

  const createMutation = useMutation({
    mutationFn: () => remoteWinboxApi.create(tenantId, deviceId),
    onSuccess: (data) => {
      setSession(data)
      if (data.status === 'active') {
        setState('active')
      } else {
        setState('connecting')
      }
    },
    onError: (err: any) => {
      setState('failed')
      setError(err.response?.data?.detail || 'Failed to create session')
    },
  })

  const closeMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('No session')
      return remoteWinboxApi.delete(tenantId, deviceId, session.session_id)
    },
    onSuccess: () => {
      setState('idle')
      setSession(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['remote-winbox-sessions', tenantId, deviceId] })
    },
    onError: (err: any) => {
      setState('failed')
      setError(err.response?.data?.detail || 'Failed to close session')
    },
  })

  const handleOpen = useCallback(() => {
    setState('requesting')
    setError(null)
    createMutation.mutate()
  }, [createMutation])

  const handleClose = useCallback(() => {
    setState('closing')
    closeMutation.mutate()
  }, [closeMutation])

  const handleRetry = useCallback(() => {
    setSession(null)
    setError(null)
    handleOpen()
  }, [handleOpen])

  const handleReset = useCallback(async () => {
    try {
      const sessions = await remoteWinboxApi.list(tenantId, deviceId)
      for (const s of sessions) {
        if (s.status === 'active' || s.status === 'creating' || s.status === 'grace') {
          await remoteWinboxApi.delete(tenantId, deviceId, s.session_id)
        }
      }
    } catch {
      // ignore cleanup errors
    }
    setState('idle')
    setSession(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ['remote-winbox-sessions', tenantId, deviceId] })
  }, [tenantId, deviceId, queryClient])

  // Build iframe URL: load Xpra HTML5 client directly via nginx /xpra/{port}/ proxy
  // path= tells the Xpra HTML5 client where to open the WebSocket connection
  const iframeSrc = session?.session_id && session?.xpra_ws_port
    ? `/xpra/${session.xpra_ws_port}/index.html?path=/xpra/${session.xpra_ws_port}/&keyboard=false&floating_menu=false&sharing=false&clipboard=false`
    : null

  // Idle / Failed / Terminated states — show button
  if (state === 'idle' || state === 'failed' || state === 'terminated') {
    return (
      <div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpen}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
            {createMutation.isPending ? 'Starting...' : 'Remote WinBox'}
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
            title="Reset all remote WinBox sessions for this device"
          >
            <RefreshCw className="h-4 w-4" />
            Reset
          </button>
        </div>
        {state === 'failed' && error && (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {state === 'terminated' && (
          <p className="mt-2 text-sm text-muted-foreground">Session ended</p>
        )}
      </div>
    )
  }

  // Requesting / Connecting — spinner
  if (state === 'requesting' || state === 'connecting') {
    return (
      <div className="rounded-md border p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className="text-sm font-medium">
            {state === 'requesting' ? 'Requesting session...' : 'Provisioning WinBox container...'}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">This may take a few seconds</p>
      </div>
    )
  }

  // Closing
  if (state === 'closing') {
    return (
      <div className="rounded-md border p-4">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className="text-sm font-medium">Closing session...</p>
        </div>
      </div>
    )
  }

  // Active — show iframe
  if (state === 'active' && iframeSrc) {
    return (
      <div
        className={
          expanded
            ? 'fixed inset-0 z-50 bg-background flex flex-col'
            : 'rounded-md border flex flex-col'
        }
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Remote WinBox</span>
            {countdown && (
              <span className="text-xs text-muted-foreground">
                Expires in {countdown}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded hover:bg-accent"
              title={expanded ? 'Minimize' : 'Maximize'}
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={handleClose}
              disabled={closeMutation.isPending}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-50"
              title="Close session"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Xpra iframe */}
        <iframe
          src={iframeSrc}
          className={expanded ? 'flex-1 w-full' : 'w-full h-[600px]'}
          style={{ border: 'none' }}
          allow="clipboard-read; clipboard-write"
          title="Remote WinBox Session"
        />
      </div>
    )
  }

  // Active but no iframe URL (missing xpra_ws_port) — show reset option
  return (
    <div className="rounded-md border p-4 space-y-2">
      <p className="text-sm text-destructive">Session active but display unavailable</p>
      <button
        onClick={handleReset}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-input bg-background hover:bg-accent text-sm"
      >
        <RefreshCw className="h-3 w-3" />
        Reset
      </button>
    </div>
  )
}
