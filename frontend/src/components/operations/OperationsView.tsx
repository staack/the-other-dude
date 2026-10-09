import { useState, type ReactNode } from 'react'
import type { FleetDevice } from '@/lib/api'
import type { AlertEvent } from '@/lib/alertsApi'
import { contactIsRecent, operationIssues } from '@/lib/operations'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import './operations.css'

export interface OperationsViewProps {
  devices: FleetDevice[]
  alerts: AlertEvent[]
  now: number
  updatedAt: number
  incomplete: boolean
  incompleteReason?: string
  renderLink?: (href: string, label: string, className?: string) => ReactNode
  refreshing: boolean
  selected: string
  onSelect: (id: string) => void
  onRefresh: () => void
  deviceHref: (id: string) => string
  fleetHref: string
}
export function OperationsView(props: OperationsViewProps) {
  const [visible, setVisible] = useState(30)
  const issues = operationIssues(props.devices, props.alerts, props.now)
  const selected = issues.find((i) => i.id === props.selected) ?? issues[0]
  const queue = issues.slice(0, visible)
  if (selected && !queue.some((i) => i.id === selected.id)) queue.unshift(selected)
  const link = (href: string, label: string, className?: string) =>
    props.renderLink?.(href, label, className) ?? (
      <a href={href} className={className}>
        {label}
      </a>
    )
  const recent = props.devices.filter((d) => contactIsRecent(d.last_seen, props.now)).length
  const uncertain = props.devices.filter(
    (d) =>
      d.status !== 'offline' &&
      d.status !== 'degraded' &&
      (d.status !== 'online' || !contactIsRecent(d.last_seen, props.now)),
  ).length
  const title = props.incomplete
    ? 'Monitoring is incomplete'
    : issues.length
      ? `${new Set(issues.map((i) => i.deviceId)).size} devices need review`
      : !props.devices.length
        ? 'No devices in this organization'
        : 'No reported problems'
  return (
    <main className="tod-operations">
      <header>
        <div>
          <p className="ops-eyebrow">Operations · preview</p>
          <h1>Network condition</h1>
        </div>
        {link(props.fleetHref, 'Fleet inventory →')}
      </header>
      <section className="ops-condition" aria-labelledby="condition-title">
        <h2 id="condition-title">{title}</h2>
        <p>
          {props.incomplete
            ? 'Some evidence could not be loaded or is incomplete. The network cannot be declared healthy.'
            : 'Device status and configured alerts are shown below. Service impact must be checked separately.'}
        </p>
        <p>{props.incompleteReason}</p>
        <p className="ops-meta">
          Recent contact · {recent}/{props.devices.length} within five minutes · {uncertain} need
          contact review
        </p>
        <p className="ops-meta">
          Last successful fleet fetch:{' '}
          {props.updatedAt ? new Date(props.updatedAt).toLocaleTimeString() : 'Not available'}.
          Contact time is not metric freshness.
        </p>
        <button onClick={props.onRefresh} disabled={props.refreshing}>
          {props.refreshing ? 'Refreshing…' : 'Refresh evidence'}
        </button>
      </section>
      {selected ? (
        <div className="ops-workspace">
          <section aria-label="Needs review">
            <h3>Needs review · {issues.length}</h3>
            <div className="ops-queue">
              {queue.map((issue) => (
                <button
                  key={issue.id}
                  aria-pressed={selected.id === issue.id}
                  onClick={() => props.onSelect(issue.id)}
                >
                  <span>{issue.title}</span>
                  <strong>
                    {issue.device?.hostname ?? issue.alert?.device_hostname ?? 'Device unavailable'}
                  </strong>
                  <small>
                    {issue.kind === 'alert'
                      ? `${issue.alert?.severity} · ${issue.alert?.status}`
                      : issue.device?.ip_address}
                  </small>
                </button>
              ))}
            </div>
            {issues.length > visible && (
              <button onClick={() => setVisible((v) => v + 30)}>Show 30 more</button>
            )}
          </section>
          <section className="ops-inspector" aria-label="Selected investigation">
            <p className="ops-eyebrow">
              {selected.kind === 'alert' ? 'Configured rule' : 'Device evidence'}
            </p>
            <h2>{selected.title}</h2>
            <p>{selected.detail}</p>
            <dl>
              <div>
                <dt>Device</dt>
                <dd>
                  {selected.device?.hostname ??
                    selected.alert?.device_hostname ??
                    'Not in fleet response'}
                </dd>
              </div>
              <div>
                <dt>Reported status</dt>
                <dd>{selected.device?.status ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Last contact</dt>
                <dd>
                  {selected.device?.last_seen &&
                  Number.isFinite(Date.parse(selected.device.last_seen))
                    ? new Date(selected.device.last_seen).toLocaleString()
                    : 'Unknown'}
                </dd>
              </div>
              {selected.alert && (
                <>
                  <div>
                    <dt>Rule value / threshold</dt>
                    <dd>
                      {selected.alert.value ?? 'Unknown'} / {selected.alert.threshold ?? 'Unknown'}
                      {selected.alert.metric ? ` (${selected.alert.metric})` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Alert fired</dt>
                    <dd>{new Date(selected.alert.fired_at).toLocaleString()}</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="ops-meta">
              Five minutes is a contact-review threshold for this preview. It is not the device’s
              configured polling interval. No latency or packet-loss measurement is available here.
            </p>
            <nav aria-label="Investigation tools">
              {selected.device &&
                link(props.deviceHref(selected.deviceId), 'Inspect device →', 'ops-primary')}
              {link('/alerts', 'Review alerts')}
            </nav>
            <details>
              <summary>Investigation checklist</summary>
              <ol>
                <li>Confirm the last contact and current device status.</li>
                <li>Check current monitoring and relevant configured alerts.</li>
                <li>Review device configuration history before considering a change.</li>
              </ol>
            </details>
          </section>
        </div>
      ) : (
        <section className="ops-empty">
          <h3>
            {props.incomplete
              ? 'Evidence needs review'
              : props.devices.length
                ? 'Nothing requires triage in this snapshot'
                : 'Add devices to begin monitoring'}
          </h3>
          <p>
            {props.incomplete
              ? 'Retry the evidence fetch or inspect Fleet and Alerts. No healthy conclusion can be drawn from missing evidence.'
              : props.devices.length
                ? 'Use Fleet for inventory and device detail. No reported problems does not establish end-to-end service health.'
                : 'Fleet inventory contains the existing device setup workflow.'}
          </p>
          {link(props.fleetHref, 'Open Fleet inventory →')}
        </section>
      )}
    </main>
  )
}
