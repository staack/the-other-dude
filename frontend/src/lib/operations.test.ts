import { describe, expect, it } from 'vitest'
import { contactIsRecent, operationIssues } from './operations'
import type { FleetDevice } from './api'
import type { AlertEvent } from './alertsApi'
const now = Date.parse('2026-10-09T12:00:00Z')
const device = {
  id: 'd1',
  hostname: 'AP',
  status: 'online',
  last_seen: '2026-10-09T11:59:00Z',
  client_count: 0,
} as FleetDevice

describe('Operations evidence', () => {
  it('does not turn zero clients into an incident', () => {
    expect(operationIssues([device], [], now)).toEqual([])
  })
  it('flags missing, invalid, future and stale contact without asserting outage', () => {
    for (const last_seen of [null, 'bad', '2026-10-09T12:01:00Z', '2026-10-09T11:50:00Z']) {
      expect(contactIsRecent(last_seen, now)).toBe(false)
      expect(operationIssues([{ ...device, last_seen }], [], now)[0].kind).toBe('contact')
    }
  })
  it('reports offline independently of old contact without duplicate contact issue', () => {
    const issues = operationIssues([{ ...device, status: 'offline', last_seen: null }], [], now)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe('Reported offline')
  })
  it('unknown status needs review even with recent contact', () => {
    expect(operationIssues([{ ...device, status: 'pending' }], [], now)[0].kind).toBe('contact')
  })
  it('includes flapping/firing configured alerts, keeps zero, excludes resolved', () => {
    const alerts = ['firing', 'flapping', 'resolved'].map(
      (status, i) =>
        ({ id: String(i), device_id: 'd1', status, value: 0, threshold: 0 }) as AlertEvent,
    )
    const issues = operationIssues([device], alerts, now)
    expect(issues).toHaveLength(2)
    expect(issues[0].alert?.value).toBe(0)
  })
  it('retains an alert when the device is absent from fleet evidence', () => {
    const issues = operationIssues(
      [],
      [{ id: 'a', device_id: 'missing', status: 'firing' } as AlertEvent],
      now,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].device).toBeUndefined()
  })
})
