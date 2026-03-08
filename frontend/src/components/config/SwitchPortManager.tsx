/**
 * SwitchPortManager -- Visual switch port layout with VLAN color coding.
 *
 * Displays physical ethernet ports in a horizontal grid resembling a
 * physical switch front panel. Each port shows link status, speed, and
 * VLAN assignment with color-coded border stripes. Clicking a port
 * opens a detail popover (read-only).
 */

import { useMemo } from 'react'
import { Zap, Network } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useConfigBrowse } from '@/hooks/useConfigPanel'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// VLAN color palette (uses chart CSS variable indices)
// ---------------------------------------------------------------------------

const VLAN_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6, 280 65% 60%))', // fallback if chart-6 not defined
]

const UNASSIGNED_COLOR = 'hsl(var(--border))'

// ---------------------------------------------------------------------------
// Speed helpers
// ---------------------------------------------------------------------------

function parseSpeed(entry: Record<string, string>): string {
  // Try the 'rate' or 'speed' property first (CRS switches expose this)
  const speed = entry.speed || entry.rate || ''
  if (speed) {
    // RouterOS may return e.g. "1Gbps", "10Gbps", "100Mbps"
    if (/10[gG]/.test(speed)) return '10G'
    if (/1[gG]/.test(speed)) return '1G'
    if (/100[mM]/.test(speed)) return '100M'
    if (/10[mM]/.test(speed)) return '10M'
    return speed
  }
  // Fallback: try to infer from actual-mtu or name
  const mtu = Number(entry['actual-mtu'] || entry.mtu || 0)
  if (mtu >= 9000) return '10G'
  return '---'
}

// ---------------------------------------------------------------------------
// SwitchPortManager
// ---------------------------------------------------------------------------

export function SwitchPortManager({ tenantId, deviceId, active }: ConfigPanelProps) {
  // Browse interfaces and bridge port assignments
  const interfaces = useConfigBrowse(tenantId, deviceId, '/interface', { enabled: active })
  const bridgePorts = useConfigBrowse(tenantId, deviceId, '/interface/bridge/port', {
    enabled: active,
  })
  const vlans = useConfigBrowse(tenantId, deviceId, '/interface/vlan', { enabled: active })

  // Filter to only ethernet interfaces
  const etherPorts = useMemo(() => {
    return interfaces.entries
      .filter(
        (e) =>
          (e.type || '').toLowerCase().includes('ether') ||
          (e.name || '').toLowerCase().startsWith('ether') ||
          (e.name || '').toLowerCase().startsWith('sfp'),
      )
      .sort((a, b) => {
        // Natural sort: ether1, ether2, ..., ether10, sfp1, etc.
        const nameA = a.name || ''
        const nameB = b.name || ''
        const numA = parseInt(nameA.replace(/\D/g, ''), 10) || 0
        const numB = parseInt(nameB.replace(/\D/g, ''), 10) || 0
        if (nameA.startsWith('sfp') && !nameB.startsWith('sfp')) return 1
        if (!nameA.startsWith('sfp') && nameB.startsWith('sfp')) return -1
        return numA - numB
      })
  }, [interfaces.entries])

  // Build VLAN color map: pvid -> color index
  const { vlanColorMap, vlanLegend } = useMemo(() => {
    const pvidSet = new Set<string>()
    for (const bp of bridgePorts.entries) {
      if (bp.pvid && bp.pvid !== '1') {
        pvidSet.add(bp.pvid)
      }
    }
    // Also include VLANs from the VLAN interface list
    for (const v of vlans.entries) {
      if (v['vlan-id']) {
        pvidSet.add(v['vlan-id'])
      }
    }

    const colorMap = new Map<string, string>()
    const legend: { id: string; name: string; color: string }[] = []
    let colorIdx = 0
    for (const pid of Array.from(pvidSet).sort((a, b) => Number(a) - Number(b))) {
      const color = VLAN_COLORS[colorIdx % VLAN_COLORS.length]
      colorMap.set(pid, color)
      // Find VLAN name if available
      const vlanEntry = vlans.entries.find((v) => v['vlan-id'] === pid)
      legend.push({
        id: pid,
        name: vlanEntry?.name || `VLAN ${pid}`,
        color,
      })
      colorIdx++
    }

    return { vlanColorMap: colorMap, vlanLegend: legend }
  }, [bridgePorts.entries, vlans.entries])

  // Map interface name -> bridge port entry for quick lookup
  const portAssignments = useMemo(() => {
    const map = new Map<string, Record<string, string>>()
    for (const bp of bridgePorts.entries) {
      if (bp.interface) {
        map.set(bp.interface, bp)
      }
    }
    return map
  }, [bridgePorts.entries])

  const isLoading = interfaces.isLoading || bridgePorts.isLoading

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-16 rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (etherPorts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-text-secondary text-sm">
        <Network className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No ethernet ports detected on this device.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Port grid */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">Switch Ports</h3>
        <div className="flex flex-wrap gap-2">
          {etherPorts.map((port) => {
            const assignment = portAssignments.get(port.name)
            const pvid = assignment?.pvid
            const vlanColor = pvid && pvid !== '1' ? vlanColorMap.get(pvid) : undefined
            return (
              <PortCard
                key={port['.id'] || port.name}
                port={port}
                assignment={assignment}
                vlanColor={vlanColor || UNASSIGNED_COLOR}
                speed={parseSpeed(port)}
              />
            )
          })}
        </div>
      </div>

      {/* VLAN Legend */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">VLAN Legend</h3>
        <div className="flex flex-wrap gap-3">
          <LegendItem color={UNASSIGNED_COLOR} label="Unassigned" />
          {vlanLegend.map((item) => (
            <LegendItem
              key={item.id}
              color={item.color}
              label={`${item.name} (ID: ${item.id})`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PortCard
// ---------------------------------------------------------------------------

function PortCard({
  port,
  assignment,
  vlanColor,
  speed,
}: {
  port: Record<string, string>
  assignment: Record<string, string> | undefined
  vlanColor: string
  speed: string
}) {
  const isRunning = port.running === 'true'
  const isDisabled = port.disabled === 'true'
  const isUp = isRunning && !isDisabled
  const portName = port.name || '---'
  // PoE heuristic: ports that include "poe" in name or device has PoE capability
  const hasPoe =
    portName.toLowerCase().includes('poe') || portName.toLowerCase().startsWith('ether')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'relative flex flex-col items-center rounded-md border bg-elevated p-2 cursor-pointer hover:border-accent/50 transition-colors',
            'w-[60px] h-[80px] justify-between',
            !isUp && 'opacity-60',
          )}
          style={{ borderLeftWidth: '4px', borderLeftColor: vlanColor }}
        >
          {/* Port name */}
          <span className="text-[10px] font-medium text-text-secondary truncate w-full text-center">
            {portName}
          </span>

          {/* Link status indicator */}
          <span
            className={cn(
              'inline-block h-3 w-3 rounded-full border-2',
              isDisabled
                ? 'bg-text-muted border-text-muted/50'
                : isRunning
                  ? 'bg-success border-success/50'
                  : 'bg-text-muted border-text-muted/50',
            )}
          />

          {/* Speed badge */}
          <span className="text-[9px] font-mono text-text-muted">{speed}</span>

          {/* PoE indicator */}
          {hasPoe && (
            <Zap
              className={cn(
                'absolute top-1 right-1 h-2.5 w-2.5',
                isUp ? 'text-warning' : 'text-text-muted/40',
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" side="bottom">
        <PortDetail port={port} assignment={assignment} speed={speed} />
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Port Detail Popover Content
// ---------------------------------------------------------------------------

function PortDetail({
  port,
  assignment,
  speed,
}: {
  port: Record<string, string>
  assignment: Record<string, string> | undefined
  speed: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm text-text-primary">{port.name}</h4>
        <Badge
          className={cn(
            port.running === 'true' && port.disabled !== 'true'
              ? 'bg-success/20 text-success border-success/40'
              : 'bg-text-muted/20 text-text-muted border-text-muted/40',
          )}
        >
          {port.disabled === 'true' ? 'Disabled' : port.running === 'true' ? 'Up' : 'Down'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-y-1.5 text-xs">
        <span className="text-text-secondary">MAC Address</span>
        <span className="font-mono text-text-primary">{port['mac-address'] || '---'}</span>

        <span className="text-text-secondary">Speed</span>
        <span className="text-text-primary">{speed}</span>

        <span className="text-text-secondary">MTU</span>
        <span className="text-text-primary">{port.mtu || port['actual-mtu'] || '---'}</span>

        <span className="text-text-secondary">Type</span>
        <span className="text-text-primary">{port.type || '---'}</span>

        {assignment && (
          <>
            <span className="text-text-secondary">Bridge</span>
            <span className="text-text-primary">{assignment.bridge || '---'}</span>

            <span className="text-text-secondary">PVID</span>
            <span className="text-text-primary">{assignment.pvid || '1'}</span>
          </>
        )}
      </div>

      <p className="text-[10px] text-text-muted pt-1 border-t border-border">
        Edit in Interfaces tab
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legend Item
// ---------------------------------------------------------------------------

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-text-secondary">
      <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {label}
    </div>
  )
}
