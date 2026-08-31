/**
 * Adoption wizard connectivity-verification tests.
 *
 * The behaviour under test exists because a freshly adopted device is saved
 * with status "unknown" and the poller only reports on its own interval, so
 * the wizard must distinguish "nobody has looked yet" from "it is down".
 */

import { describe, it, expect, vi } from 'vitest'
import {
  mapDeviceStatus,
  pollVerifyStatuses,
  type VerifyStatus,
} from '../adoptionVerify'

const noSleep = () => Promise.resolve()

describe('mapDeviceStatus', () => {
  it('treats "online" as verified', () => {
    expect(mapDeviceStatus('online')).toBe('online')
  })

  it('treats "offline" as unreachable', () => {
    expect(mapDeviceStatus('offline')).toBe('unreachable')
  })

  it('treats "unknown" as still waiting, not unreachable', () => {
    expect(mapDeviceStatus('unknown')).toBe('waiting')
  })

  it('treats a missing status as still waiting', () => {
    expect(mapDeviceStatus(undefined)).toBe('waiting')
    expect(mapDeviceStatus(null)).toBe('waiting')
  })
})

describe('pollVerifyStatuses', () => {
  it('does not report a freshly created device as unreachable', async () => {
    // The exact bug: status is "unknown" at first check.
    const onUpdate = vi.fn()
    const result = await pollVerifyStatuses({
      deviceIds: ['d1'],
      fetchStatuses: async () => ({ d1: 'unknown' }),
      onUpdate,
      intervalMs: 5,
      timeoutMs: 10, // 2 attempts
      sleep: noSleep,
    })

    expect(result.d1).not.toBe('unreachable')
    expect(result.d1).toBe('timeout')
  })

  it('reports online once the poller finally reports', async () => {
    let calls = 0
    const fetchStatuses = async () => {
      calls++
      // Still unknown for the first two polls, then the poller runs.
      return { d1: calls < 3 ? 'unknown' : 'online' }
    }

    const result = await pollVerifyStatuses({
      deviceIds: ['d1'],
      fetchStatuses,
      onUpdate: vi.fn(),
      intervalMs: 5,
      timeoutMs: 100,
      sleep: noSleep,
    })

    expect(result.d1).toBe('online')
    expect(calls).toBe(3)
  })

  it('stops polling as soon as every device has settled', async () => {
    const fetchStatuses = vi.fn(async () => ({ d1: 'online', d2: 'offline' }))

    const result = await pollVerifyStatuses({
      deviceIds: ['d1', 'd2'],
      fetchStatuses,
      onUpdate: vi.fn(),
      intervalMs: 5,
      timeoutMs: 1000, // would allow 200 attempts
      sleep: noSleep,
    })

    expect(result).toEqual({ d1: 'online', d2: 'unreachable' })
    expect(fetchStatuses).toHaveBeenCalledTimes(1)
  })

  it('reports a genuinely down device as unreachable', async () => {
    const result = await pollVerifyStatuses({
      deviceIds: ['d1'],
      fetchStatuses: async () => ({ d1: 'offline' }),
      onUpdate: vi.fn(),
      intervalMs: 5,
      timeoutMs: 50,
      sleep: noSleep,
    })

    expect(result.d1).toBe('unreachable')
  })

  it('does not claim unreachable when the list request itself fails', async () => {
    const result = await pollVerifyStatuses({
      deviceIds: ['d1'],
      fetchStatuses: async () => {
        throw new Error('network down')
      },
      onUpdate: vi.fn(),
      intervalMs: 5,
      timeoutMs: 15,
      sleep: noSleep,
    })

    expect(result.d1).toBe('timeout')
  })

  it('keeps a settled result even if a later poll regresses to unknown', async () => {
    let calls = 0
    const fetchStatuses = async () => {
      calls++
      return { d1: calls === 1 ? 'online' : 'unknown', d2: 'unknown' }
    }

    const result = await pollVerifyStatuses({
      deviceIds: ['d1', 'd2'],
      fetchStatuses,
      onUpdate: vi.fn(),
      intervalMs: 5,
      timeoutMs: 15,
      sleep: noSleep,
    })

    expect(result.d1).toBe('online')
    expect(result.d2).toBe('timeout')
  })

  it('stops immediately when cancelled', async () => {
    const signal = { cancelled: false }
    const fetchStatuses = vi.fn(async () => {
      signal.cancelled = true
      return { d1: 'unknown' }
    })

    await pollVerifyStatuses({
      deviceIds: ['d1'],
      fetchStatuses,
      onUpdate: vi.fn(),
      intervalMs: 5,
      timeoutMs: 1000,
      signal,
      sleep: noSleep,
    })

    expect(fetchStatuses).toHaveBeenCalledTimes(1)
  })

  it('starts every device in the waiting state', async () => {
    const seen: Record<string, VerifyStatus>[] = []
    await pollVerifyStatuses({
      deviceIds: ['d1', 'd2'],
      fetchStatuses: async () => ({ d1: 'online', d2: 'online' }),
      onUpdate: (s) => seen.push(s),
      intervalMs: 5,
      timeoutMs: 10,
      sleep: noSleep,
    })

    expect(seen[0]).toEqual({ d1: 'waiting', d2: 'waiting' })
  })

  it('handles an empty device list without polling', async () => {
    const fetchStatuses = vi.fn(async () => ({}))
    const result = await pollVerifyStatuses({
      deviceIds: [],
      fetchStatuses,
      onUpdate: vi.fn(),
      sleep: noSleep,
    })

    expect(result).toEqual({})
    expect(fetchStatuses).not.toHaveBeenCalled()
  })
})
