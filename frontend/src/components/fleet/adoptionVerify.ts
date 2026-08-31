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

export type VerifyStatus =
  | 'pending'
  | 'waiting'
  | 'online'
  | 'unreachable'
  | 'timeout'

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
