import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { metricsApi, type DeviceResponse } from "@/lib/api";
import { alertsApi } from "@/lib/alertsApi";
import { InvestigationView } from "./InvestigationView";

export function DeviceInvestigation({
  device,
  tenantId,
  issue,
  userId,
  range,
  onRange,
}: {
  device: DeviceResponse;
  tenantId: string;
  issue?: string;
  userId: string;
  range: string;
  onRange: (range: string) => void;
}) {
  const [initialEnd] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const key = ["investigation", userId, tenantId, device.id];
  const window = () => {
    const end = new Date();
    return [
      new Date(
        end.getTime() -
          (range === "1h" ? 1 : range === "24h" ? 24 : 6) * 3600000,
      ).toISOString(),
      end.toISOString(),
    ] as const;
  };
  const health = useQuery({
    queryKey: [...key, "health", range],
    queryFn: async () => {
      const [start, end] = window();
      return {
        points: await metricsApi.health(tenantId, device.id, start, end),
        end: Date.parse(end),
      };
    },
    refetchInterval: 30000,
  });
  const events = useQuery({
    queryKey: [...key, "events"],
    queryFn: () =>
      alertsApi.getAlerts(tenantId, { device_id: device.id, per_page: 20 }),
    refetchInterval: 30000,
  });
  const selectedId = issue?.startsWith("alert:") ? issue.slice(6) : undefined;
  const selectedAlert = useQuery({
    queryKey: [...key, "selected-alert", selectedId],
    queryFn: () =>
      alertsApi.getAlerts(tenantId, {
        device_id: device.id,
        alert_id: selectedId,
        per_page: 1,
      }),
    enabled: !!selectedId,
    refetchInterval: selectedId ? 30000 : false,
  });
  const traffic = useQuery({
    queryKey: [...key, "traffic", range],
    queryFn: () => metricsApi.interfaces(tenantId, device.id, ...window()),
    enabled: trafficOpen,
    refetchInterval: trafficOpen ? 30000 : false,
  });
  return (
    <InvestigationView
      device={device}
      now={now}
      selectedAlertId={selectedId}
      selectedAlert={selectedAlert.data?.items.find(
        (event) => event.id === selectedId && event.device_id === device.id,
      )}
      selectedAlertLoading={!!selectedId && selectedAlert.isPending}
      selectedAlertError={selectedAlert.isError}
      range={range}
      onRange={onRange}
      windowEnd={health.data?.end ?? initialEnd}
      health={health.data?.points ?? []}
      healthLoading={health.isPending}
      healthError={health.isError}
      events={events.data?.items ?? []}
      eventsLoading={events.isPending}
      eventsError={events.isError}
      eventsTotal={events.data?.total ?? 0}
      traffic={traffic.data ?? []}
      trafficOpen={trafficOpen}
      onTraffic={() => setTrafficOpen((v) => !v)}
      trafficLoading={traffic.isPending}
      trafficError={traffic.isError}
      refreshing={
        health.isFetching ||
        events.isFetching ||
        (!!selectedId && selectedAlert.isFetching) ||
        (trafficOpen && traffic.isFetching)
      }
      onRefresh={() => {
        void health.refetch();
        void events.refetch();
        if (selectedId) void selectedAlert.refetch();
        if (trafficOpen) void traffic.refetch();
      }}
      renderNavigation={() => (
        <>
          <Link
            to="/operations"
            search={{ issue: issue ?? "" }}
            className="inv-back"
          >
            ← Operations
          </Link>
          <Link
            to="/tenants/$tenantId/devices/$deviceId"
            params={{ tenantId, deviceId: device.id }}
            search={{ view: "manage", issue, period: range }}
            className="inv-manage"
          >
            Configuration & tools →
          </Link>
        </>
      )}
    />
  );
}
