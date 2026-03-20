import { Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { Link } from '@tanstack/react-router'
import type { FleetDevice } from '@/lib/api'
import { DeviceLink } from '@/components/ui/device-link'
import { formatUptime } from '@/lib/utils'

interface DeviceMarkerProps {
  device: FleetDevice
  tenantId: string
}

const STATUS_COLORS: Record<string, string> = {
  online: '#22c55e',  // green-500
  offline: '#ef4444', // red-500
  unknown: '#eab308', // yellow-500
}

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.unknown
}

function createMarkerIcon(status: string): L.DivIcon {
  const color = getStatusColor(status)
  return L.divIcon({
    className: '', // Remove default leaflet-div-icon styling
    html: `<div style="
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  })
}

const statusLabels: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  unknown: 'Unknown',
}

export function DeviceMarker({ device, tenantId }: DeviceMarkerProps) {
  if (device.latitude == null || device.longitude == null) return null

  const icon = createMarkerIcon(device.status)
  const statusColor = getStatusColor(device.status)
  const statusLabel = statusLabels[device.status] ?? device.status

  // In super_admin "all" mode, tenantId may be empty — fall back to device's own tenant_id
  const resolvedTenantId = tenantId || device.tenant_id

  return (
    <Marker position={[device.latitude, device.longitude]} icon={icon}>
      <Popup>
        <div className="min-w-[200px] text-sm font-sans">
          <DeviceLink tenantId={resolvedTenantId} deviceId={device.id} className="font-semibold text-base">
            {device.hostname}
          </DeviceLink>
          <div className="text-text-secondary space-y-0.5">
            <div>IP: {device.ip_address}</div>
            {device.model && <div>Model: {device.model}</div>}
            <div>Uptime: {formatUptime(device.uptime_seconds)}</div>
            {device.last_cpu_load != null && <div>CPU: {device.last_cpu_load}%</div>}
            {device.last_memory_used_pct != null && <div>Memory: {device.last_memory_used_pct}%</div>}
            {device.client_count != null && device.client_count > 0 && (
              <div>Clients: {device.client_count}{device.avg_signal != null && ` (avg ${device.avg_signal} dBm)`}</div>
            )}
            {device.cpe_signal != null && (
              <div>Signal: {device.cpe_signal} dBm{device.ap_hostname && ` to ${device.ap_hostname}`}</div>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              Status:
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: statusColor }}
              />
              <span>{statusLabel}</span>
            </div>
          </div>
          <div className="flex gap-3 mt-2 pt-2 border-t border-border">
            <Link
              to="/config-editor"
              className="text-info hover:text-accent text-xs font-medium"
            >
              Config Editor &rarr;
            </Link>
          </div>
        </div>
      </Popup>
    </Marker>
  )
}
