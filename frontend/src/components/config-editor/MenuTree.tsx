/**
 * MenuTree -- left sidebar tree navigation for common RouterOS menu paths.
 * Includes a custom path input for arbitrary paths.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, File } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

interface TreeNode {
  label: string
  path: string
  children?: TreeNode[]
}

const MENU_TREE: TreeNode[] = [
  {
    label: 'interface',
    path: '/interface',
    children: [
      { label: 'bridge', path: '/interface/bridge' },
      { label: 'ethernet', path: '/interface/ethernet' },
      { label: 'vlan', path: '/interface/vlan' },
      { label: 'wireless', path: '/interface/wireless' },
      { label: 'bonding', path: '/interface/bonding' },
      { label: 'list', path: '/interface/list' },
    ],
  },
  {
    label: 'ip',
    path: '/ip',
    children: [
      { label: 'address', path: '/ip/address' },
      { label: 'route', path: '/ip/route' },
      { label: 'dns', path: '/ip/dns' },
      { label: 'dhcp-client', path: '/ip/dhcp-client' },
      { label: 'dhcp-server', path: '/ip/dhcp-server' },
      {
        label: 'firewall',
        path: '/ip/firewall',
        children: [
          { label: 'filter', path: '/ip/firewall/filter' },
          { label: 'nat', path: '/ip/firewall/nat' },
          { label: 'mangle', path: '/ip/firewall/mangle' },
          { label: 'raw', path: '/ip/firewall/raw' },
          { label: 'address-list', path: '/ip/firewall/address-list' },
          { label: 'connection', path: '/ip/firewall/connection' },
        ],
      },
      { label: 'pool', path: '/ip/pool' },
      { label: 'service', path: '/ip/service' },
      { label: 'neighbor', path: '/ip/neighbor' },
    ],
  },
  {
    label: 'system',
    path: '/system',
    children: [
      { label: 'identity', path: '/system/identity' },
      { label: 'clock', path: '/system/clock' },
      { label: 'ntp', path: '/system/ntp' },
      { label: 'resource', path: '/system/resource' },
      { label: 'routerboard', path: '/system/routerboard' },
      { label: 'scheduler', path: '/system/scheduler' },
      { label: 'script', path: '/system/script' },
      { label: 'logging', path: '/system/logging' },
      { label: 'package', path: '/system/package' },
    ],
  },
  {
    label: 'routing',
    path: '/routing',
    children: [
      {
        label: 'ospf',
        path: '/routing/ospf',
        children: [
          { label: 'instance', path: '/routing/ospf/instance' },
          { label: 'area', path: '/routing/ospf/area' },
          { label: 'interface-template', path: '/routing/ospf/interface-template' },
          { label: 'static-neighbor', path: '/routing/ospf/static-neighbor' },
        ],
      },
      {
        label: 'bgp',
        path: '/routing/bgp',
        children: [
          { label: 'connection', path: '/routing/bgp/connection' },
          { label: 'template', path: '/routing/bgp/template' },
        ],
      },
      { label: 'filter rule', path: '/routing/filter/rule' },
      { label: 'table', path: '/routing/table' },
      { label: 'rule', path: '/routing/rule' },
    ],
  },
  {
    label: 'queue',
    path: '/queue',
    children: [
      { label: 'simple', path: '/queue/simple' },
      { label: 'tree', path: '/queue/tree' },
      { label: 'type', path: '/queue/type' },
    ],
  },
  {
    label: 'tool',
    path: '/tool',
    children: [
      { label: 'bandwidth-server', path: '/tool/bandwidth-server' },
      { label: 'email', path: '/tool/email' },
      { label: 'fetch', path: '/tool/fetch' },
      { label: 'graphing', path: '/tool/graphing' },
      { label: 'netwatch', path: '/tool/netwatch' },
      { label: 'ping', path: '/tool/ping' },
      { label: 'sniffer', path: '/tool/sniffer' },
    ],
  },
  { label: 'user', path: '/user' },
  { label: 'snmp', path: '/snmp' },
  { label: 'certificate', path: '/certificate' },
]

interface MenuTreeProps {
  onPathSelect: (path: string) => void
  currentPath: string
}

function TreeItem({
  node,
  currentPath,
  onPathSelect,
  depth = 0,
}: {
  node: TreeNode
  currentPath: string
  onPathSelect: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(currentPath.startsWith(node.path))
  const hasChildren = node.children && node.children.length > 0
  const isActive = currentPath === node.path

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded)
          }
          // Only browse leaf nodes -- container paths can't be printed
          if (!hasChildren) {
            onPathSelect(node.path)
          }
        }}
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded transition-colors',
          isActive
            ? 'bg-elevated text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-elevated/50',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
          )
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {hasChildren ? (
          expanded ? (
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          ) : (
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          )
        ) : (
          <File className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        )}
        <span className="truncate">{node.label}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              currentPath={currentPath}
              onPathSelect={onPathSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function MenuTree({ onPathSelect, currentPath }: MenuTreeProps) {
  const [customPath, setCustomPath] = useState('')

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-border">
        <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Menu</div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {MENU_TREE.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            currentPath={currentPath}
            onPathSelect={onPathSelect}
          />
        ))}
      </div>
      <div className="px-2 py-2 border-t border-border">
        <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Custom path</div>
        <Input
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customPath.trim()) {
              onPathSelect(customPath.trim())
            }
          }}
          placeholder="/caps-man/interface"
          className="h-7 text-xs bg-elevated/50 border-border"
        />
      </div>
    </div>
  )
}
