import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DeviceResponse } from "@/lib/api";
import { renderWithProviders } from "@/test/test-utils";
const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  events: vi.fn(),
  traffic: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  metricsApi: { health: mocks.health, interfaces: mocks.traffic },
}));
vi.mock("@/lib/alertsApi", () => ({ alertsApi: { getAlerts: mocks.events } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
import { DeviceInvestigation } from "./DeviceInvestigation";
const device = {
  id: "device-a",
  hostname: "Router",
  status: "online",
  last_seen: null,
} as DeviceResponse;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.health.mockResolvedValue([]);
  mocks.events.mockResolvedValue({ items: [], total: 0 });
  mocks.traffic.mockResolvedValue([]);
});
afterEach(cleanup);
describe("Investigation query boundaries", () => {
  it("loads traffic only on request and scopes caches to user, tenant, device and period", async () => {
    const { queryClient } = renderWithProviders(
      <DeviceInvestigation
        device={device}
        tenantId="tenant-a"
        userId="user-a"
        range="1h"
        onRange={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.health).toHaveBeenCalledOnce());
    expect(mocks.health.mock.calls[0].slice(0, 2)).toEqual([
      "tenant-a",
      "device-a",
    ]);
    expect(mocks.events.mock.calls[0]).toEqual([
      "tenant-a",
      { device_id: "device-a", per_page: 20 },
    ]);
    expect(mocks.traffic).not.toHaveBeenCalled();
    expect(
      queryClient
        .getQueryCache()
        .find({
          queryKey: [
            "investigation",
            "user-a",
            "tenant-a",
            "device-a",
            "health",
            "1h",
          ],
        }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Interface traffic/ }));
    await waitFor(() => expect(mocks.traffic).toHaveBeenCalledOnce());
    expect(mocks.traffic.mock.calls[0].slice(0, 2)).toEqual([
      "tenant-a",
      "device-a",
    ]);
  });
  it("shows failures instead of a successful empty fetch", async () => {
    mocks.health.mockRejectedValue(new Error("unavailable"));
    mocks.events.mockRejectedValue(new Error("unavailable"));
    renderWithProviders(
      <DeviceInvestigation
        device={device}
        tenantId="tenant-a"
        userId="user-a"
        range="6h"
        onRange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  });
});
