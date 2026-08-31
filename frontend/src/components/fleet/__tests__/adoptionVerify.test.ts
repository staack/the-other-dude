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
  probeVerifyStatuses,
  resultFromProbe,
  tlsDowngradeCost,
  type VerifyStatus,
} from '../adoptionVerify'
import type { DeviceConnectionTestResponse } from '@/lib/api'

const noSleep = () => Promise.resolve()

function probeResponse(
  over: Partial<DeviceConnectionTestResponse> = {},
): DeviceConnectionTestResponse {
  return {
    ok: true,
    stage: 'done',
    reason: 'ok',
    message: 'Connected.',
    detail: null,
    tls_mode: 'auto',
    suggested_tls_mode: null,
    identity: null,
    version: null,
    board_name: null,
    elapsed_ms: 12,
    probe_available: true,
    checked_at: '2026-08-30T00:00:00Z',
    ...over,
  }
}

/** Mimics an axios error, which is what the real client throws. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } })
}

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

describe('resultFromProbe', () => {
  it('maps a successful probe to online and keeps the identity', () => {
    const r = resultFromProbe(
      probeResponse({ ok: true, identity: 'rtr-1', version: '7.23.2' }),
    )
    expect(r.status).toBe('online')
    expect(r.identity).toBe('rtr-1')
    expect(r.version).toBe('7.23.2')
  })

  it('maps a failed probe to unreachable and keeps the message', () => {
    const r = resultFromProbe(
      probeResponse({
        ok: false,
        reason: 'auth_failed',
        message: 'Login was rejected.',
      }),
    )
    expect(r.status).toBe('unreachable')
    expect(r.message).toBe('Login was rejected.')
    expect(r.reason).toBe('auth_failed')
  })

  it('treats an unavailable probe as uncheckable, NOT as a down device', () => {
    // The one case where ok:false must not be read as "the device is bad".
    const r = resultFromProbe(
      probeResponse({
        ok: false,
        probe_available: false,
        reason: 'probe_unavailable',
        message: 'The probe did not respond.',
      }),
    )
    expect(r.status).toBe('uncheckable')
    expect(r.status).not.toBe('unreachable')
  })

  it('carries a verified suggested mode through', () => {
    const r = resultFromProbe(
      probeResponse({ ok: false, suggested_tls_mode: 'plain' }),
    )
    expect(r.suggestedTlsMode).toBe('plain')
  })

  it('does not invent a suggestion when the probe gave none', () => {
    expect(resultFromProbe(probeResponse()).suggestedTlsMode).toBeNull()
  })
})

describe('probeVerifyStatuses', () => {
  it('probes every device and reports each result', async () => {
    const probe = vi.fn(async (id: string) =>
      probeResponse({ ok: id === 'd1' }),
    )
    const out = await probeVerifyStatuses({
      deviceIds: ['d1', 'd2'],
      probe,
      onUpdate: vi.fn(),
      sleep: noSleep,
    })

    expect(out.results.d1.status).toBe('online')
    expect(out.results.d2.status).toBe('unreachable')
    expect(out.unsupported).toBe(false)
    expect(out.unresolved).toEqual([])
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('reports unsupported and stops when the endpoint 404s', async () => {
    // Frontend deployed ahead of the backend: fall back, do not error per device.
    const probe = vi.fn(async () => {
      throw httpError(404)
    })
    const out = await probeVerifyStatuses({
      deviceIds: ['d1', 'd2', 'd3'],
      probe,
      onUpdate: vi.fn(),
      sleep: noSleep,
    })

    expect(out.unsupported).toBe(true)
    expect(out.unresolved).toEqual(['d1', 'd2', 'd3'])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('stops on a 429 and leaves the remainder unresolved for the poll', async () => {
    let n = 0
    const probe = vi.fn(async () => {
      n++
      if (n > 2) throw httpError(429)
      return probeResponse({ ok: true })
    })
    const out = await probeVerifyStatuses({
      deviceIds: ['d1', 'd2', 'd3', 'd4'],
      probe,
      onUpdate: vi.fn(),
      sleep: noSleep,
    })

    expect(out.unsupported).toBe(false)
    expect(out.results.d1.status).toBe('online')
    expect(out.results.d2.status).toBe('online')
    expect(out.unresolved).toEqual(['d3', 'd4'])
  })

  it('marks a single failing device uncheckable without aborting the run', async () => {
    const probe = vi.fn(async (id: string) => {
      if (id === 'd1') throw httpError(500)
      return probeResponse({ ok: true })
    })
    const out = await probeVerifyStatuses({
      deviceIds: ['d1', 'd2'],
      probe,
      onUpdate: vi.fn(),
      sleep: noSleep,
    })

    expect(out.results.d1.status).toBe('uncheckable')
    expect(out.results.d2.status).toBe('online')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('spaces calls to respect the rate limit', async () => {
    const sleep = vi.fn(async () => {})
    await probeVerifyStatuses({
      deviceIds: ['d1', 'd2', 'd3'],
      probe: async () => probeResponse(),
      onUpdate: vi.fn(),
      spacingMs: 2000,
      sleep,
    })

    // One gap between each pair, none after the last.
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('stops when cancelled', async () => {
    const signal = { cancelled: false }
    const probe = vi.fn(async () => {
      signal.cancelled = true
      return probeResponse()
    })
    await probeVerifyStatuses({
      deviceIds: ['d1', 'd2', 'd3'],
      probe,
      onUpdate: vi.fn(),
      signal,
      sleep: noSleep,
    })

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('starts every device waiting', async () => {
    const seen: Record<string, { status: string }>[] = []
    await probeVerifyStatuses({
      deviceIds: ['d1', 'd2'],
      probe: async () => probeResponse(),
      onUpdate: (r) => seen.push(r),
      sleep: noSleep,
    })
    expect(seen[0]).toEqual({
      d1: { status: 'waiting' },
      d2: { status: 'waiting' },
    })
  })
})

describe('tlsDowngradeCost', () => {
  it('warns that plain sends credentials unencrypted', () => {
    const cost = tlsDowngradeCost('plain')
    expect(cost).toBeTruthy()
    expect(cost).toMatch(/unencrypted/i)
  })

  it('warns that insecure stops verifying the certificate', () => {
    const cost = tlsDowngradeCost('insecure')
    expect(cost).toBeTruthy()
    expect(cost).toMatch(/certificate/i)
  })

  it('says nothing for modes that do not weaken the connection', () => {
    expect(tlsDowngradeCost('auto')).toBeNull()
    expect(tlsDowngradeCost('portal_ca')).toBeNull()
  })

  it('never lets plain be offered without a stated cost', () => {
    // The invariant: "auto" refuses plaintext deliberately, so a one-click
    // switch to plain must always carry its consequence. If someone empties
    // this string, the UI silently starts offering a security downgrade with
    // no warning attached.
    expect(tlsDowngradeCost('plain')).not.toBeNull()
    expect((tlsDowngradeCost('plain') ?? '').length).toBeGreaterThan(40)
  })
})
