import { useEffect, useRef, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import type { FleetDevice } from '@/lib/api'
import { formatUptime } from '@/lib/utils'
import { useUIStore } from '@/lib/store'

import 'maplibre-gl/dist/maplibre-gl.css'

// Register PMTiles protocol once
const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

interface FleetMapProps {
  devices: FleetDevice[]
  tenantId: string
}

const DEFAULT_CENTER: [number, number] = [-89.6, 39.8]
const DEFAULT_ZOOM = 4

const STATUS_COLORS: Record<string, string> = {
  online: '#22c55e',
  offline: '#ef4444',
  unknown: '#eab308',
}

function buildMapStyle(theme: 'dark' | 'light') {
  return {
    version: 8 as const,
    glyphs: '/map-fonts/{fontstack}/{range}.pbf',
    sprite: `/map-assets/sprites/${theme}`,
    sources: {
      protomaps: {
        type: 'vector' as const,
        url: 'pmtiles:///tiles/us.pmtiles',
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor(theme), { lang: 'en' }),
  }
}

function deviceToGeoJSON(devices: FleetDevice[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: devices
      .filter((d) => d.latitude != null && d.longitude != null)
      .map((d) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [d.longitude!, d.latitude!],
        },
        properties: {
          id: d.id,
          hostname: d.hostname,
          ip_address: d.ip_address,
          status: d.status,
          model: d.model || '',
          uptime_seconds: d.uptime_seconds,
          last_cpu_load: d.last_cpu_load,
          last_memory_used_pct: d.last_memory_used_pct,
          client_count: d.client_count,
          avg_signal: d.avg_signal,
          tenant_id: d.tenant_id,
          color: STATUS_COLORS[d.status] || STATUS_COLORS.unknown,
        },
      })),
  }
}

export function FleetMap({ devices, tenantId }: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const theme = useUIStore((s) => s.theme)

  const geojson = useMemo(() => deviceToGeoJSON(devices), [devices])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(theme),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 17,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      // Device markers source with clustering
      map.addSource('devices', {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      })

      // Cluster circles
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'devices',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#22c55e', 10,
            '#f59e0b', 50,
            '#ef4444',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            18, 10,
            24, 50,
            32,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Cluster count labels
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'devices',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Noto Sans Medium'],
          'text-size': 13,
        },
        paint: {
          'text-color': '#ffffff',
        },
      })

      // Individual device dots
      map.addLayer({
        id: 'device-points',
        type: 'circle',
        source: 'devices',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Click on cluster to zoom in
      map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        if (!features.length) return
        const clusterId = features[0].properties.cluster_id
        const source = map.getSource('devices') as maplibregl.GeoJSONSource
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
          map.easeTo({ center: coords, zoom })
        })
      })

      // Click on device to show popup
      map.on('click', 'device-points', (e) => {
        if (!e.features?.length) return
        const f = e.features[0]
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number]
        const p = f.properties

        const resolvedTenantId = tenantId || p.tenant_id

        let html = `<div style="font-family:system-ui,sans-serif;font-size:13px;min-width:200px;">
          <a href="/tenants/${resolvedTenantId}/devices/${p.id}" style="font-weight:600;font-size:14px;color:#7dd3fc;text-decoration:none;">${p.hostname}</a>
          <div style="color:#94a3b8;margin-top:4px;">
            <div>IP: ${p.ip_address}</div>`
        if (p.model) html += `<div>Model: ${p.model}</div>`
        if (p.uptime_seconds) html += `<div>Uptime: ${formatUptime(p.uptime_seconds)}</div>`
        if (p.last_cpu_load != null) html += `<div>CPU: ${p.last_cpu_load}%</div>`
        if (p.last_memory_used_pct != null) html += `<div>Memory: ${p.last_memory_used_pct}%</div>`
        if (p.client_count != null && p.client_count > 0) {
          html += `<div>Clients: ${p.client_count}`
          if (p.avg_signal != null) html += ` (avg ${p.avg_signal} dBm)`
          html += `</div>`
        }
        html += `<div style="margin-top:4px;display:flex;align-items:center;gap:6px;">
              Status:
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
              ${p.status}
            </div>
          </div>
        </div>`

        new maplibregl.Popup({ offset: 10, maxWidth: '300px' })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map)
      })

      // Cursor changes
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'device-points', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'device-points', () => { map.getCanvas().style.cursor = '' })

      // Fit bounds to all devices
      if (geojson.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds()
        geojson.features.forEach((f) => {
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
          bounds.extend([lng, lat])
        })
        map.fitBounds(bounds, { padding: 60, maxZoom: 14 })
      }
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-add device layers after style change (setStyle wipes all sources/layers)
  const addDeviceLayers = (map: maplibregl.Map) => {
    if (map.getSource('devices')) return
    map.addSource('devices', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    })
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'devices',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#22c55e', 10, '#f59e0b', 50, '#ef4444'],
        'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 50, 32],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'devices',
      filter: ['has', 'point_count'],
      layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Medium'], 'text-size': 13 },
      paint: { 'text-color': '#ffffff' },
    })
    map.addLayer({
      id: 'device-points',
      type: 'circle',
      source: 'devices',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
  }

  // Switch map theme when app theme changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(buildMapStyle(theme))
    map.once('styledata', () => addDeviceLayers(map))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  // Update device data when it changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const source = map.getSource('devices') as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(geojson)
    }
  }, [geojson])

  return <div ref={containerRef} className="h-full w-full" />
}
