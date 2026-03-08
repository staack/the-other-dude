import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface SSEEvent {
  type: string // device_status, alert_fired, alert_resolved, config_push, firmware_progress, metric_update
  data: unknown // parsed JSON payload
  id: string // NATS sequence number
}

type EventCallback = (event: SSEEvent) => void

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  'device_status',
  'alert_fired',
  'alert_resolved',
  'config_push',
  'firmware_progress',
  'metric_update',
] as const

const INITIAL_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30000
const RETRY_MULTIPLIER = 2
const MAX_RETRIES = 5

// SSE exchange tokens are valid for 30 seconds, so reconnect before expiry.
// Using 25 seconds gives a comfortable margin.
const TOKEN_REFRESH_INTERVAL_MS = 25 * 1000

// ─── SSE Token Exchange ─────────────────────────────────────────────────────

/**
 * Exchange the current session (httpOnly cookie) for a short-lived,
 * single-use SSE token via POST /api/auth/sse-token.
 *
 * This avoids exposing the full JWT in the EventSource URL query parameter.
 */
async function getSSEToken(): Promise<string> {
  const { data } = await api.post<{ token: string }>('/api/auth/sse-token')
  return data.token
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useEventStream(
  tenantId: string | null,
  onEvent: EventCallback,
): {
  connectionState: ConnectionState
  lastConnectedAt: Date | null
  reconnect: () => void
} {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null)

  // Refs to persist across renders without causing re-renders
  const eventSourceRef = useRef<EventSource | null>(null)
  const retryCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onEventRef = useRef<EventCallback>(onEvent)
  const isUnmountedRef = useRef(false)

  // Keep onEvent ref current without triggering reconnection
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  // Close existing EventSource and clear timers
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (tokenRefreshTimerRef.current !== null) {
      clearInterval(tokenRefreshTimerRef.current)
      tokenRefreshTimerRef.current = null
    }
  }, [])

  // Core connection function
  const connect = useCallback(async () => {
    if (!tenantId || isUnmountedRef.current) return

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setConnectionState('connecting')

    // Exchange session cookie for a short-lived SSE token
    let sseToken: string
    try {
      sseToken = await getSSEToken()
    } catch {
      // Token exchange failed -- go to reconnect flow
      if (isUnmountedRef.current) return
      handleReconnect()
      return
    }

    if (isUnmountedRef.current) return

    const baseUrl = import.meta.env.VITE_API_URL ?? ''
    const url = `${baseUrl}/api/tenants/${tenantId}/events/stream?token=${encodeURIComponent(sseToken)}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      if (isUnmountedRef.current) return
      setConnectionState('connected')
      setLastConnectedAt(new Date())
      retryCountRef.current = 0
    }

    // Register named event listeners for each SSE event type
    EVENT_TYPES.forEach((type) => {
      es.addEventListener(type, (e: MessageEvent) => {
        if (isUnmountedRef.current) return
        try {
          const data: unknown = JSON.parse(e.data as string)
          onEventRef.current({ type, data, id: e.lastEventId })
        } catch {
          // Malformed JSON -- skip event
        }
      })
    })

    es.onerror = () => {
      if (isUnmountedRef.current) return
      es.close()
      eventSourceRef.current = null
      handleReconnect()
    }

    // Set up token refresh interval — SSE tokens are 30s, reconnect at 25s
    if (tokenRefreshTimerRef.current !== null) {
      clearInterval(tokenRefreshTimerRef.current)
    }
    tokenRefreshTimerRef.current = setInterval(() => {
      if (isUnmountedRef.current) return
      // Silently reconnect with a fresh SSE token
      void connect()
    }, TOKEN_REFRESH_INTERVAL_MS)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, cleanup])

  // Reconnection with exponential backoff
  const handleReconnect = useCallback(() => {
    if (isUnmountedRef.current) return

    if (retryCountRef.current >= MAX_RETRIES) {
      setConnectionState('disconnected')
      return
    }

    setConnectionState('reconnecting')
    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, retryCountRef.current),
      MAX_RETRY_DELAY_MS,
    )
    retryCountRef.current += 1

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      void connect()
    }, delay)
  }, [connect])

  // Manual reconnect: reset retry count, start fresh
  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    cleanup()
    void connect()
  }, [cleanup, connect])

  // Main effect: connect on mount / tenantId change, cleanup on unmount
  useEffect(() => {
    isUnmountedRef.current = false

    if (tenantId) {
      void connect()
    } else {
      cleanup()
      setConnectionState('disconnected')
    }

    return () => {
      isUnmountedRef.current = true
      cleanup()
    }
  }, [tenantId, connect, cleanup])

  return { connectionState, lastConnectedAt, reconnect }
}
