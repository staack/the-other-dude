import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InvestigationView } from "./InvestigationView";
import { trendSegments } from "./trend";
import type { DeviceResponse, HealthMetricPoint } from "@/lib/api";
const sample = (bucket: string, avg_cpu: number | null): HealthMetricPoint => ({
  bucket,
  avg_cpu,
  max_cpu: avg_cpu,
  avg_mem_pct: 0,
  avg_disk_pct: null,
  avg_temp: null,
});
const props = {
  windowEnd: Date.now(),
  device: {
    hostname: "Router",
    ip_address: "192.0.2.1",
    model: "hAP",
    status: "online",
    last_seen: null,
  } as DeviceResponse,
  range: "1h",
  onRange: vi.fn(),
  health: [],
  healthLoading: false,
  healthError: false,
  events: [],
  eventsTotal: 0,
  eventsLoading: false,
  eventsError: false,
  traffic: [],
  trafficOpen: false,
  onTraffic: vi.fn(),
  trafficLoading: false,
  trafficError: false,
  refreshing: false,
  onRefresh: vi.fn(),
  renderNavigation: () => null,
};
afterEach(cleanup);
describe("Investigation evidence", () => {
  it("never bridges null evidence or uses array position for time", () => {
    const data = [
      sample("2026-10-09T00:00:00Z", 0),
      sample("2026-10-09T00:01:00Z", null),
      sample("2026-10-09T00:02:00Z", 50),
    ];
    expect(
      trendSegments(
        data,
        "avg_cpu",
        Date.parse(data[0].bucket),
        Date.parse(data[2].bucket),
      ),
    ).toEqual(["0.00,100.00", "1000.00,50.00"]);
  });
  it("breaks a long collection gap instead of drawing a continuous line", () => {
    const data = [0, 1, 2, 20, 21].map((n) =>
      sample(new Date(n * 60000).toISOString(), 20),
    );
    expect(trendSegments(data, "avg_cpu", 0, 21 * 60000)).toHaveLength(2);
  });
  it("does not equate empty or failed data with health", () => {
    render(<InvestigationView {...props} healthError eventsError />);
    expect(screen.getByText(/No health samples/)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText(/healthy/i)).not.toBeInTheDocument();
  });
  it("keeps zero readings distinct from missing readings", () => {
    render(
      <InvestigationView
        {...props}
        health={[sample(new Date().toISOString(), 0)]}
      />,
    );
    expect(screen.getAllByText("0.0%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });
  it("keeps traffic closed and makes truncation explicit", () => {
    render(<InvestigationView {...props} eventsTotal={21} />);
    const toggle = screen.getByRole("button", { name: /Interface traffic/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Received average")).not.toBeInTheDocument();
    expect(
      screen.getByText("Showing 0 of 21 alert records."),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(props.onTraffic).toHaveBeenCalledOnce();
  });
  it("evaluates contact against current time even when a cached health window is older", () => {
    const seen = Date.parse("2026-10-09T12:00:00Z");
    render(
      <InvestigationView
        {...props}
        device={{ ...props.device, last_seen: new Date(seen).toISOString() }}
        windowEnd={seen + 60000}
        now={seen + 10 * 60000}
        healthError
      />,
    );
    expect(screen.getByText(/Contact needs review/)).toBeInTheDocument();
  });
});
