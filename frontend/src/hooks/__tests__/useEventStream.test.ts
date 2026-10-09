import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn(async () => ({ data: { token: 'sse-token' } })) },
}))

import { useEventStream } from '../useEventStream'

/** Minimal EventSource stand-in: records instances, lets tests fire open/error. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener() {}
  close() {
    this.closed = true
  }
}

async function flush() {
  // Let the token-exchange promise chain settle before timers run.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useEventStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps retrying at the capped delay after the retry budget is exhausted', async () => {
    const { result } = renderHook(() => useEventStream('tenant-1', () => {}))
    await flush()
    expect(FakeEventSource.instances).toHaveLength(1)

    // Six consecutive failures: 1s, 2s, 4s, 8s, 16s back-off, then the budget is gone.
    for (let i = 0; i < 6; i++) {
      const es = FakeEventSource.instances[FakeEventSource.instances.length - 1]
      act(() => es.onerror?.())
      // Within the budget the badge says "reconnecting"; once it is spent, "disconnected".
      expect(result.current.connectionState).toBe(i < 5 ? 'reconnecting' : 'disconnected')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      await flush()
    }
    const attemptsSoFar = FakeEventSource.instances.length

    // Fail once more past the budget: the hook must still schedule another attempt
    // at the capped delay instead of staying down until a manual reconnect.
    const latest = FakeEventSource.instances[attemptsSoFar - 1]
    act(() => latest.onerror?.())
    expect(result.current.connectionState).toBe('disconnected')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    await flush()
    expect(FakeEventSource.instances.length).toBe(attemptsSoFar + 1)
  })

  it('does not reconnect a healthy stream on a timer', async () => {
    renderHook(() => useEventStream('tenant-1', () => {}))
    await flush()
    const es = FakeEventSource.instances[0]
    act(() => es.onopen?.())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    await flush()

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(es.closed).toBe(false)
  })
})
