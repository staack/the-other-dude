/**
 * Connectivity verification for the adoption wizard's final step.
 *
 * A freshly created device is persisted with status "unknown" and nothing
 * triggers an immediate poll -- the Go poller picks it up on its own interval
 * (60s by default, 120s in the dev compose). A single short-delay check
 * therefore reports every healthy device as unreachable, so instead we poll
 * until the poller has actually reported, and say "waiting" until it does.
 *
 * The poll is deliberately expressed in terms of an injected `fetchStatuses`
 * so the source of truth can be swapped later: if a real test-connection
 * endpoint lands, only the caller changes, not this loop.
 */

import type { DeviceConnectionTestResponse } from '@/lib/api'

export type VerifyStatus =
  | 'pending'
  | 'waiting'
  | 'online'
  | 'unreachable'
  | 'timeout'
  /** The probe itself could not run, so there is no verdict on the device. */
  | 'uncheckable'

/** What the wizard knows about one device after verification. */
export interface VerifyResult {
  status: VerifyStatus
  /** Safe to render verbatim; comes from the probe. */
  message?: string
  detail?: string | null
  reason?: string
  /** A mode the probe verified works. Offer it; never apply it silently. */
  suggestedTlsMode?: string | null
  identity?: string | null
  version?: string | null
}

/** The device statuses the poller actually writes. */
export function mapDeviceStatus(
  status: string | null | undefined,
): VerifyStatus {
  if (status === 'online') return 'online'
  if (status === 'offline') return 'unreachable'
  // "unknown" (or absent) -- the poller has not reported on this device yet.
  return 'waiting'
}

export const VERIFY_POLL_INTERVAL_MS = 5_000
export const VERIFY_TIMEOUT_MS = 90_000

/** test-connection is limited to 30/min, and costs one call per device.
 *  2s spacing sits at that ceiling instead of tripping it. */
export const PROBE_SPACING_MS = 2_000

/** Turn one probe response into what the wizard should show. */
export function resultFromProbe(
  probe: DeviceConnectionTestResponse,
): VerifyResult {
  // No verdict at all -- the poller never answered. This is NOT "device down".
  if (!probe.probe_available) {
    return {
      status: 'uncheckable',
      message: probe.message,
      detail: probe.detail,
      reason: probe.reason,
    }
  }
  return {
    status: probe.ok ? 'online' : 'unreachable',
    message: probe.message,
    detail: probe.detail,
    reason: probe.reason,
    suggestedTlsMode: probe.suggested_tls_mode,
    identity: probe.identity,
    version: probe.version,
  }
}

function httpStatusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

export interface ProbeVerifyOptions {
  deviceIds: string[]
  probe: (deviceId: string) => Promise<DeviceConnectionTestResponse>
  onUpdate: (results: Record<string, VerifyResult>) => void
  spacingMs?: number
  signal?: { cancelled: boolean }
  sleep?: (ms: number) => Promise<void>
}

export interface ProbeVerifyOutcome {
  results: Record<string, VerifyResult>
  /** The endpoint is not deployed -- the caller should fall back to polling. */
  unsupported: boolean
  /** Devices with no verdict yet, because we stopped early (e.g. a 429). */
  unresolved: string[]
}

/**
 * Probe each device in turn, spaced to respect the endpoint's rate limit.
 *
 * Stops and reports `unsupported` if the endpoint 404s, so a frontend that is
 * ahead of its backend degrades to status polling instead of erroring on every
 * device. A 429 stops the run too, leaving the rest `unresolved` for the poll.
 */
export async function probeVerifyStatuses({
  deviceIds,
  probe,
  onUpdate,
  spacingMs = PROBE_SPACING_MS,
  signal,
  sleep = defaultSleep,
}: ProbeVerifyOptions): Promise<ProbeVerifyOutcome> {
  const results: Record<string, VerifyResult> = {}
  for (const id of deviceIds) results[id] = { status: 'waiting' }
  onUpdate({ ...results })

  for (let i = 0; i < deviceIds.length; i++) {
    if (signal?.cancelled) break
    const id = deviceIds[i]

    try {
      results[id] = resultFromProbe(await probe(id))
      onUpdate({ ...results })
    } catch (err) {
      const status = httpStatusOf(err)

      // Frontend is ahead of the backend: no probe exists at all.
      if (status === 404) {
        return { results, unsupported: true, unresolved: deviceIds.slice(i) }
      }
      // Out of budget. Leave the rest to the poll rather than hammering.
      if (status === 429) {
        return { results, unsupported: false, unresolved: deviceIds.slice(i) }
      }
      results[id] = {
        status: 'uncheckable',
        message: 'The connection check could not be run for this device.',
        detail: status ? `HTTP ${status}` : null,
      }
      onUpdate({ ...results })
    }

    if (i < deviceIds.length - 1) await sleep(spacingMs)
  }

  const unresolved = deviceIds.filter((id) => results[id].status === 'waiting')
  return { results, unsupported: false, unresolved }
}

/** A status is settled once the poller has given us a real answer. */
function isSettled(s: VerifyStatus): boolean {
  return s === 'online' || s === 'unreachable'
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface PollVerifyOptions {
  deviceIds: string[]
  /** Resolves device id -> persisted status, for the devices we care about. */
  fetchStatuses: () => Promise<Record<string, string | undefined>>
  onUpdate: (statuses: Record<string, VerifyStatus>) => void
  intervalMs?: number
  timeoutMs?: number
  /** Set `cancelled` to stop the loop (e.g. on unmount). */
  signal?: { cancelled: boolean }
  sleep?: (ms: number) => Promise<void>
}

/**
 * Poll until every device has a real answer, or until the timeout elapses.
 *
 * Devices that never get polled end as 'timeout', NOT 'unreachable' -- we have
 * no evidence they are down, only that nothing has looked at them yet.
 */
export async function pollVerifyStatuses({
  deviceIds,
  fetchStatuses,
  onUpdate,
  intervalMs = VERIFY_POLL_INTERVAL_MS,
  timeoutMs = VERIFY_TIMEOUT_MS,
  signal,
  sleep = defaultSleep,
}: PollVerifyOptions): Promise<Record<string, VerifyStatus>> {
  let statuses: Record<string, VerifyStatus> = {}
  for (const id of deviceIds) statuses[id] = 'waiting'
  onUpdate({ ...statuses })

  if (deviceIds.length === 0) return statuses

  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs)
    if (signal?.cancelled) return statuses

    let byId: Record<string, string | undefined>
    try {
      byId = await fetchStatuses()
    } catch {
      // A transient list failure is not evidence a device is down; keep waiting.
      continue
    }
    if (signal?.cancelled) return statuses

    statuses = { ...statuses }
    for (const id of deviceIds) {
      if (isSettled(statuses[id])) continue
      statuses[id] = mapDeviceStatus(byId[id])
    }
    onUpdate({ ...statuses })

    if (deviceIds.every((id) => isSettled(statuses[id]))) return statuses
  }

  // Ran out of time. Say so honestly rather than claiming the devices are down.
  statuses = { ...statuses }
  for (const id of deviceIds) {
    if (!isSettled(statuses[id])) statuses[id] = 'timeout'
  }
  onUpdate({ ...statuses })
  return statuses
}
