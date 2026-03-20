import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import type { FleetDevice } from '@/lib/api'
import { DeviceMarker } from './DeviceMarker'

import 'leaflet/dist/leaflet.css'

interface FleetMapProps {
  devices: FleetDevice[]
  tenantId: string
}

const DEFAULT_CENTER: [number, number] = [39.8, -89.6]
const DEFAULT_ZOOM = 5

function AutoFitBounds({ devices }: { devices: FleetDevice[] }) {
  const map = useMap()

  useEffect(() => {
    if (devices.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
      return
    }

    const bounds = L.latLngBounds(
      devices.map((d) => [d.latitude!, d.longitude!] as [number, number]),
    )

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  }, [devices, map])

  return null
}

function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const childMarkers = cluster.getAllChildMarkers()
  const count = childMarkers.length

  let hasOffline = false
  let hasOnline = false

  for (const marker of childMarkers) {
    const icon = marker.getIcon() as L.DivIcon
    const html = (icon.options.html as string) ?? ''
    if (html.includes('#ef4444')) {
      hasOffline = true
    } else if (html.includes('#22c55e')) {
      hasOnline = true
    }
  }

  let bgColor: string
  if (hasOffline && hasOnline) {
    bgColor = '#f59e0b'
  } else if (hasOffline) {
    bgColor = '#ef4444'
  } else {
    bgColor = '#22c55e'
  }

  const size = count < 10 ? 34 : count < 100 ? 40 : 48

  return L.divIcon({
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${bgColor};
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: ${count < 100 ? 13 : 11}px;
      font-family: system-ui, sans-serif;
    ">${count}</div>`,
    className: '',
    iconSize: L.point(size, size),
    iconAnchor: L.point(size / 2, size / 2),
  })
}

export function FleetMap({ devices, tenantId }: FleetMapProps) {
  const mappedDevices = useMemo(
    () => devices.filter((d) => d.latitude != null && d.longitude != null),
    [devices],
  )

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full"
      scrollWheelZoom
      maxZoom={19}
      style={{ background: 'hsl(var(--background))' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="/osm-tiles/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <AutoFitBounds devices={mappedDevices} />
      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={createClusterIcon}
        maxClusterRadius={50}
        spiderfyOnMaxZoom
        showCoverageOnHover={false}
      >
        {mappedDevices.map((device) => (
          <DeviceMarker key={device.id} device={device} tenantId={tenantId} />
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  )
}
