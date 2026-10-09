import { contactIsRecent } from "@/lib/operations";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import { trendSegments } from "./trend";
import type { ReactNode } from "react";
import type {
  DeviceResponse,
  HealthMetricPoint,
  InterfaceMetricPoint,
} from "@/lib/api";
import type { AlertEvent } from "@/lib/alertsApi";
import "./investigation.css";

interface Props {
  now?: number;
  selectedAlertId?: string;
  selectedAlert?: AlertEvent;
  selectedAlertLoading?: boolean;
  selectedAlertError?: boolean;
  device: DeviceResponse;
  windowEnd: number;
  range: string;
  onRange: (range: string) => void;
  health: HealthMetricPoint[];
  healthLoading: boolean;
  healthError: boolean;
  events: AlertEvent[];
  eventsTotal: number;
  eventsLoading: boolean;
  eventsError: boolean;
  traffic: InterfaceMetricPoint[];
  trafficOpen: boolean;
  onTraffic: () => void;
  trafficLoading: boolean;
  trafficError: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  renderNavigation: () => ReactNode;
}
const date = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Not recorded";
const number = (value: number | null | undefined, suffix = "") =>
  value != null && Number.isFinite(value)
    ? `${value.toFixed(1)}${suffix}`
    : "Not recorded";
const bps = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? "Not recorded"
    : value >= 1e6
      ? `${(value / 1e6).toFixed(2)} Mbps`
      : `${(value / 1e3).toFixed(2)} Kbps`;

export function InvestigationView(p: Props) {
  const health = [...p.health]
    .filter((x) => Number.isFinite(Date.parse(x.bucket)))
    .sort((a, b) => Date.parse(a.bucket) - Date.parse(b.bucket));
  const latest = health.at(-1);
  const end = p.windowEnd,
    start = end - (p.range === "1h" ? 1 : p.range === "24h" ? 24 : 6) * 3600000;
  const traffic = new Map<string, InterfaceMetricPoint>();
  for (const point of p.traffic)
    if (
      !traffic.has(point.interface) ||
      Date.parse(point.bucket) >
        Date.parse(traffic.get(point.interface)!.bucket)
    )
      traffic.set(point.interface, point);
  return (
    <div className="device-investigation">
      <nav aria-label="Investigation navigation">{p.renderNavigation()}</nav>
      <header>
        <div>
          <p className="inv-eyebrow">Device investigation</p>
          <h1>{p.device.hostname}</h1>
          <p>
            {p.device.model ?? p.device.board_name ?? "Device"} ·{" "}
            {p.device.ip_address} ·{" "}
            {p.device.routeros_version
              ? `RouterOS ${p.device.routeros_version}`
              : p.device.device_type}
          </p>
        </div>
        <div className="inv-status">
          <span>{p.device.status}</span>
          <small>Reported device status</small>
        </div>
      </header>
      <div className="inv-contact">
        Last device contact <strong>{date(p.device.last_seen)}</strong>
        <span>Contact time does not establish metric freshness.</span>
      </div>
      {!contactIsRecent(p.device.last_seen, p.now ?? p.windowEnd) && (
        <p className="inv-notice" role="status">
          Contact needs review. Last contact is outside the five-minute preview
          window or is not recorded. The reported status does not establish
          current reachability.
        </p>
      )}
      {p.selectedAlertId && (
        <section aria-labelledby="selected-alert-title">
          <h2 id="selected-alert-title">Alert under investigation</h2>
          {p.selectedAlertLoading ? (
            <p role="status">Loading selected alert…</p>
          ) : p.selectedAlertError ? (
            <p role="alert" className="inv-notice">
              The selected alert could not be refreshed. Any retained record is
              from an earlier request.
            </p>
          ) : !p.selectedAlert ? (
            <p className="inv-notice">
              The selected alert is unavailable for this device. This does not
              establish that it resolved.
            </p>
          ) : null}
          {p.selectedAlert && (
            <div className="inv-selected-alert">
              <strong>
                {p.selectedAlert.message ??
                  p.selectedAlert.rule_name ??
                  p.selectedAlert.metric ??
                  "Configured alert"}
              </strong>
              <p>
                {p.selectedAlert.status} · {p.selectedAlert.severity}
              </p>
              <p>
                Recorded value {number(p.selectedAlert.value)} · Threshold{" "}
                {number(p.selectedAlert.threshold)}
              </p>
              <p>
                Fired {date(p.selectedAlert.fired_at)}
                {p.selectedAlert.resolved_at
                  ? ` · Resolved ${date(p.selectedAlert.resolved_at)}`
                  : ""}
              </p>
            </div>
          )}
        </section>
      )}
      <section aria-labelledby="health-title">
        <div className="inv-section-heading">
          <div>
            <h2 id="health-title">Health over time</h2>
            <p>Collected averages. Gaps are missing evidence.</p>
          </div>
          <div className="inv-controls">
            <label>
              Period{" "}
              <select
                value={p.range}
                onChange={(e) => p.onRange(e.target.value)}
              >
                <option value="1h">Last hour</option>
                <option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option>
              </select>
            </label>
            <button onClick={p.onRefresh} disabled={p.refreshing}>
              {p.refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {p.healthError && (
          <p role="alert" className="inv-notice">
            Health evidence could not be refreshed. Any retained samples are
            from an earlier request.
          </p>
        )}
        {p.healthLoading ? (
          <p role="status">Loading health evidence…</p>
        ) : !latest ? (
          <p className="inv-empty">
            No health samples in this period. This does not establish that the
            device is offline.
          </p>
        ) : (
          <>
            <div className="inv-readings">
              <div>
                CPU<strong>{number(latest.avg_cpu, "%")}</strong>
              </div>
              <div>
                Memory<strong>{number(latest.avg_mem_pct, "%")}</strong>
              </div>
              <div>
                Disk<strong>{number(latest.avg_disk_pct, "%")}</strong>
              </div>
              <div>
                Temperature<strong>{number(latest.avg_temp, " °C")}</strong>
              </div>
            </div>
            <p className="inv-sampled">
              Latest returned bucket: {date(latest.bucket)} · {health.length}{" "}
              {health.length === 1 ? "bucket" : "buckets"}
            </p>
            <div className="inv-trends">
              {(["avg_cpu", "avg_mem_pct"] as const).map((metric) => (
                <figure key={metric}>
                  <figcaption>
                    {metric === "avg_cpu" ? "CPU" : "Memory"}{" "}
                    <span>0–100%</span>
                  </figcaption>
                  <svg
                    viewBox="0 0 1000 100"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${metric === "avg_cpu" ? "CPU" : "Memory"} average usage over ${p.range}`}
                  >
                    <line x1="0" y1="0" x2="1000" y2="0" />
                    <line x1="0" y1="50" x2="1000" y2="50" />
                    <line x1="0" y1="100" x2="1000" y2="100" />
                    {trendSegments(health, metric, start, end).map(
                      (points, i) =>
                        points.includes(" ") ? (
                          <polyline key={i} points={points} />
                        ) : (
                          <circle
                            key={i}
                            cx={points.split(",")[0]}
                            cy={points.split(",")[1]}
                            r="2.5"
                          />
                        ),
                    )}
                  </svg>
                  <div className="inv-axis">
                    <time>
                      {new Date(start).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span>Time</span>
                    <time>
                      {new Date(end).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                </figure>
              ))}
            </div>
            <details>
              <summary>View recorded health samples</summary>
              <div className="inv-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Bucket</th>
                      <th>CPU</th>
                      <th>Memory</th>
                      <th>Disk</th>
                      <th>Temperature</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health
                      .slice(-100)
                      .reverse()
                      .map((sample, i) => (
                        <tr key={`${sample.bucket}-${i}`}>
                          <td>{date(sample.bucket)}</td>
                          <td>{number(sample.avg_cpu, "%")}</td>
                          <td>{number(sample.avg_mem_pct, "%")}</td>
                          <td>{number(sample.avg_disk_pct, "%")}</td>
                          <td>{number(sample.avg_temp, " °C")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {health.length > 100 && (
                <p>Showing the latest 100 returned buckets.</p>
              )}
            </details>
          </>
        )}
      </section>
      <section aria-labelledby="events-title">
        <h2 id="events-title">Recent alert events</h2>
        <p>
          Alert records for this device; this is not a router log or a complete
          change history.
        </p>
        {p.eventsError && (
          <p role="alert" className="inv-notice">
            Alert evidence could not be refreshed.
          </p>
        )}
        {p.eventsLoading ? (
          <p role="status">Loading alert records…</p>
        ) : p.events.length === 0 ? (
          <p className="inv-empty">No alert records returned.</p>
        ) : (
          <ol className="inv-events">
            {p.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>
                    {event.message ??
                      event.rule_name ??
                      event.metric ??
                      "Alert"}
                  </strong>
                  <span>
                    {event.status} · {event.severity}
                  </span>
                  {event.value != null && (
                    <p>
                      Recorded value {number(Number(event.value))}
                      {event.threshold != null
                        ? ` · Threshold ${number(Number(event.threshold))}`
                        : ""}
                    </p>
                  )}
                </div>
                <time>
                  {date(event.fired_at)}
                  {event.resolved_at && (
                    <small>Resolved {date(event.resolved_at)}</small>
                  )}
                </time>
              </li>
            ))}
          </ol>
        )}
        {p.eventsTotal > p.events.length && (
          <p className="inv-notice">
            Showing {p.events.length} of {p.eventsTotal} alert records.
          </p>
        )}
      </section>
      <section>
        <button
          className="inv-disclosure"
          aria-expanded={p.trafficOpen}
          onClick={p.onTraffic}
        >
          {p.trafficOpen ? "−" : "+"} Interface traffic
        </button>
        <p>Loads on request. Observed rates, without guessed link capacity.</p>
        {p.trafficOpen && (
          <>
            {p.trafficError && (
              <p role="alert" className="inv-notice">
                Traffic evidence could not be refreshed.
              </p>
            )}
            {p.trafficLoading ? (
              <p role="status">Loading interface traffic…</p>
            ) : !traffic.size ? (
              <p className="inv-empty">
                No interface samples returned for this period.
              </p>
            ) : (
              <div className="inv-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>Received average</th>
                      <th>Sent average</th>
                      <th>Latest bucket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...traffic.values()].map((point) => (
                      <tr key={point.interface}>
                        <th scope="row">{point.interface}</th>
                        <td>{bps(point.avg_rx_bps)}</td>
                        <td>{bps(point.avg_tx_bps)}</td>
                        <td>{date(point.bucket)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
