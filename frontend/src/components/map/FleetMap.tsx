import { useEffect, useMemo } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import * as protomapsL from 'protomaps-leaflet'
import type { FleetDevice } from '@/lib/api'
import { DeviceMarker } from './DeviceMarker'

import 'leaflet/dist/leaflet.css'

interface FleetMapProps {
  devices: FleetDevice[]
  tenantId: string
}

/** Default world view when no devices have coordinates. */
const DEFAULT_CENTER: [number, number] = [20, 0]
const DEFAULT_ZOOM = 2

/**
 * Self-hosted PMTiles basemap layer via protomaps-leaflet.
 * Loads regional PMTiles files from /tiles/ (no third-party requests).
 * Multiple region files are layered — tiles outside downloaded regions show blank.
 */
const PMTILES_REGIONS = ['/tiles/wisconsin.pmtiles', '/tiles/florida.pmtiles']

function ProtomapsLayer() {
  const map = useMap()

  useEffect(() => {
    const layers: L.Layer[] = []
    for (const url of PMTILES_REGIONS) {
      const layer = protomapsL.leafletLayer({ url, flavor: 'dark' })
      layer.addTo(map)
      layers.push(layer)
    }
    return () => {
      for (const layer of layers) map.removeLayer(layer)
    }
  }, [map])

  return null
}

/**
 * Inner component that auto-fits the map to device bounds
 * whenever the device list changes.
 */
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

/**
 * Custom cluster icon factory.
 * - All online: green cluster
 * - Any offline: red cluster
 * - Mixed: yellow/orange cluster
 */
function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const childMarkers = cluster.getAllChildMarkers()
  const count = childMarkers.length

  // Determine aggregate status by inspecting marker HTML color
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
    bgColor = '#f59e0b' // amber-500 — mixed
  } else if (hasOffline) {
    bgColor = '#ef4444' // red-500 — all offline
  } else {
    bgColor = '#22c55e' // green-500 — all online
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
  // Filter to only devices that have coordinates
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
      style={{ background: 'hsl(var(--background))' }}
    >
      <ProtomapsLayer />
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
