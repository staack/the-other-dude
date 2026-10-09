import type { FleetDevice } from './api'
import type { AlertEvent } from './alertsApi'

// This is a review threshold, not proof of an outage or the configured poll interval.
export const CONTACT_REVIEW_MS = 5 * 60_000
export interface OperationIssue {
  id: string
  device: FleetDevice | undefined
  deviceId: string
  title: string
  detail: string
  kind: 'status' | 'contact' | 'alert'
  alert?: AlertEvent
}
export function contactIsRecent(lastSeen: string | null, now: number): boolean {
  if (!lastSeen) return false
  const time = Date.parse(lastSeen)
  return Number.isFinite(time) && time <= now && now - time <= CONTACT_REVIEW_MS
}
export function operationIssues(
  devices: FleetDevice[],
  alerts: AlertEvent[],
  now: number,
): OperationIssue[] {
  const issues: OperationIssue[] = []
  const devicesById = new Map(devices.map((device) => [device.id, device]))
  for (const device of devices) {
    if (device.status === 'offline' || device.status === 'degraded') {
      issues.push({
        id: `status:${device.id}`,
        device,
        deviceId: device.id,
        kind: 'status',
        title: device.status === 'offline' ? 'Reported offline' : 'Reported degraded',
        detail: 'Reported device status. Cause and user impact are not established.',
      })
    } else if (device.status !== 'online' || !contactIsRecent(device.last_seen, now)) {
      issues.push({
        id: `contact:${device.id}`,
        device,
        deviceId: device.id,
        kind: 'contact',
        title: 'Contact needs review',
        detail:
          'Recent contact is missing or the device status is unknown. This does not establish an outage.',
      })
    }
  }
  for (const alert of alerts) {
    if (alert.status !== 'firing' && alert.status !== 'flapping') continue
    issues.push({
      id: `alert:${alert.id}`,
      device: devicesById.get(alert.device_id),
      deviceId: alert.device_id,
      kind: 'alert',
      title: alert.rule_name || alert.metric || 'Configured alert',
      detail: alert.message || 'Review the configured rule and device evidence.',
      alert,
    })
  }
  return issues.sort((a, b) => {
    const rank = (i: OperationIssue) =>
      i.kind === 'status' && i.device?.status === 'offline'
        ? 0
        : i.kind === 'alert' && i.alert?.severity === 'critical'
          ? 1
          : i.kind === 'contact'
            ? 3
            : 2
    return rank(a) - rank(b)
  })
}
