/**
 * TopologyMap -- Reactflow-based network topology visualization.
 *
 * Renders managed MikroTik devices as custom nodes with hostname, IP, and
 * status indicators. Edges represent neighbor discovery or shared-subnet
 * connections. Uses dagre for automatic hierarchical layout.
 *
 * Double-click a node to navigate to its device detail page.
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from 'reactflow'
import dagre from '@dagrejs/dagre'
import { Router, Server, Loader2, NetworkIcon, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { networkApi, type TopologyNode, type TopologyEdge } from '@/lib/networkApi'
import 'reactflow/dist/style.css'

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

const NODE_WIDTH = 200
const NODE_HEIGHT = 80

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100, ranker: 'network-simplex' })

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  dagre.layout(g)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

// ---------------------------------------------------------------------------
// Edge color rotation (chart tokens)
// ---------------------------------------------------------------------------

const EDGE_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
]

// ---------------------------------------------------------------------------
// Custom DeviceNode component
// ---------------------------------------------------------------------------

interface DeviceNodeData {
  hostname: string
  ip: string
  status: string
  model: string | null
  uptime: string | null
}

function DeviceNode({ data }: NodeProps<DeviceNodeData>) {
  const isOnline = data.status === 'online'
  const DeviceIcon = data.model?.toLowerCase().includes('switch') ? Server : Router

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface px-3 py-2 min-w-[180px]',
        'transition-colors',
        isOnline ? 'border-border' : 'border-error/30',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2" />
      <div className="flex items-start gap-2">
        <DeviceIcon className="h-5 w-5 text-text-muted flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-text-primary truncate">
              {data.hostname}
            </span>
            <span
              className={cn(
                'h-2 w-2 rounded-full flex-shrink-0',
                isOnline ? 'bg-success' : 'bg-error',
              )}
              title={isOnline ? 'Online' : 'Offline'}
            />
          </div>
          <span className="text-xs text-text-muted block truncate">{data.ip}</span>
          {data.model && (
            <span className="text-[10px] text-text-muted/70 block truncate">
              {data.model}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2" />
    </div>
  )
}

const nodeTypes = { device: DeviceNode }

// ---------------------------------------------------------------------------
// Tooltip (shown on single click / hover)
// ---------------------------------------------------------------------------

interface TooltipData {
  hostname: string
  ip: string
  model: string | null
  status: string
  uptime: string | null
  x: number
  y: number
}

function NodeTooltip({ data }: { data: TooltipData; onClose?: () => void }) {
  return (
    <div
      className="absolute z-50 rounded-lg border border-border bg-elevated px-3 py-2 text-xs pointer-events-none"
      style={{ left: data.x + 10, top: data.y - 10 }}
    >
      <div className="font-medium text-text-primary">{data.hostname}</div>
      <div className="text-text-muted mt-0.5">IP: {data.ip}</div>
      {data.model && <div className="text-text-muted">Model: {data.model}</div>}
      <div className="text-text-muted">
        Status:{' '}
        <span className={data.status === 'online' ? 'text-success' : 'text-error'}>
          {data.status}
        </span>
      </div>
      {data.uptime && <div className="text-text-muted">Uptime: {data.uptime}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TopologyMap component
// ---------------------------------------------------------------------------

interface TopologyMapProps {
  tenantId: string
}

export function TopologyMap({ tenantId }: TopologyMapProps) {
  const navigate = useNavigate()
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [showSubnetEdges, setShowSubnetEdges] = useState(false)

  const { data: topology, isLoading, error } = useQuery({
    queryKey: ['topology', tenantId],
    queryFn: () => networkApi.getTopology(tenantId),
    enabled: !!tenantId,
    refetchInterval: 5 * 60 * 1000, // Re-fetch every 5 minutes (matches cache TTL)
  })

  // Count subnet edges for the toggle label
  const subnetEdgeCount = useMemo(
    () => topology?.edges.filter((e: TopologyEdge) => e.label === 'shared subnet').length ?? 0,
    [topology],
  )

  // Convert backend data to reactflow nodes/edges
  const { nodes, edges } = useMemo(() => {
    if (!topology?.nodes.length) return { nodes: [], edges: [] }

    const rfNodes: Node<DeviceNodeData>[] = topology.nodes.map((n: TopologyNode) => ({
      id: n.id,
      type: 'device',
      data: {
        hostname: n.hostname,
        ip: n.ip,
        status: n.status,
        model: n.model,
        uptime: n.uptime,
      },
      position: { x: 0, y: 0 }, // Will be set by dagre
    }))

    // Filter edges: exclude subnet edges when toggle is off
    const visibleEdges = topology.edges.filter(
      (e: TopologyEdge) => showSubnetEdges || e.label !== 'shared subnet',
    )

    const rfEdges: Edge[] = visibleEdges.map((e: TopologyEdge, idx: number) => {
      const isSubnet = e.label === 'shared subnet'
      const isVpn = e.label === 'vpn tunnel'
      return {
        id: `${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        label: isSubnet ? undefined : e.label,
        animated: isVpn,
        style: {
          stroke: isSubnet
            ? 'hsl(var(--muted))'
            : isVpn
              ? 'hsl(var(--accent))'
              : EDGE_COLORS[idx % EDGE_COLORS.length],
          strokeWidth: isSubnet ? 1 : 2,
          strokeDasharray: isSubnet ? '6 3' : undefined,
          opacity: isSubnet ? 0.4 : 1,
        },
        labelStyle: { fontSize: 10, fill: 'hsl(var(--text-muted))' },
        labelBgStyle: { fill: 'hsl(var(--surface))', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        markerEnd: isSubnet
          ? undefined
          : { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      }
    })

    return getLayoutedElements(rfNodes, rfEdges)
  }, [topology, showSubnetEdges])

  // Double-click navigates to device detail
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node<DeviceNodeData>) => {
      navigate({
        to: '/tenants/$tenantId/devices/$deviceId',
        params: { tenantId, deviceId: node.id },
      })
    },
    [navigate, tenantId],
  )

  // Single-click shows tooltip
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<DeviceNodeData>) => {
      setTooltip({
        hostname: node.data.hostname,
        ip: node.data.ip,
        model: node.data.model,
        status: node.data.status,
        uptime: node.data.uptime,
        x: event.clientX,
        y: event.clientY,
      })
    },
    [],
  )

  // Clear tooltip on pane click
  const onPaneClick = useCallback(() => {
    setTooltip(null)
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <span className="text-sm text-text-muted">Loading topology...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="rounded-lg border border-error/30 bg-error/5 p-6 text-center max-w-sm">
          <p className="text-sm text-error">Failed to load topology</p>
          <p className="text-xs text-text-muted mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }

  // Empty state
  if (!nodes.length) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-center">
          <NetworkIcon className="h-12 w-12 text-text-muted/40" />
          <div>
            <p className="text-sm text-text-secondary">No devices found</p>
            <p className="text-xs text-text-muted mt-1">
              Add devices to your tenant to see the network topology.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full" data-testid="topology-map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="hsl(var(--muted))" gap={20} size={1} />
        <Controls
          className="!bg-surface !border-border [&>button]:!bg-surface [&>button]:!border-border [&>button]:!text-text-secondary [&>button:hover]:!bg-elevated"
        />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as DeviceNodeData
            return data.status === 'online'
              ? 'hsl(var(--success))'
              : 'hsl(var(--error))'
          }}
          maskColor="hsl(var(--background) / 0.7)"
          className="!bg-surface !border-border"
        />
      </ReactFlow>

      {/* Click tooltip */}
      {tooltip && <NodeTooltip data={tooltip} onClose={() => setTooltip(null)} />}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-surface/90 backdrop-blur-sm px-3 py-2 text-xs text-text-muted">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" /> Online
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-error" /> Offline
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-accent" /> VPN
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2" style={{ borderColor: 'hsl(var(--chart-1))' }} /> Neighbor
          </span>
          {subnetEdgeCount > 0 && (
            <button
              onClick={() => setShowSubnetEdges((v) => !v)}
              className="flex items-center gap-1.5 hover:text-text-secondary transition-colors"
              title={showSubnetEdges ? 'Hide shared subnet edges' : 'Show shared subnet edges'}
            >
              {showSubnetEdges ? (
                <Eye className="h-3 w-3" />
              ) : (
                <EyeOff className="h-3 w-3" />
              )}
              <span className="w-4 border-t border-dashed border-muted" />
              Subnet ({subnetEdgeCount})
            </button>
          )}
          <span className="text-text-muted/60">Double-click to open device</span>
        </div>
      </div>
    </div>
  )
}
