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
      {
        label: 'bridge',
        path: '/interface/bridge',
        children: [
          { label: 'bridge', path: '/interface/bridge' },
          { label: 'port', path: '/interface/bridge/port' },
          { label: 'vlan', path: '/interface/bridge/vlan' },
          { label: 'host', path: '/interface/bridge/host' },
        ],
      },
      { label: 'ethernet', path: '/interface/ethernet' },
      { label: 'vlan', path: '/interface/vlan' },
      { label: 'wireless', path: '/interface/wireless' },
      {
        label: 'wifi',
        path: '/interface/wifi',
        children: [
          { label: 'wifi', path: '/interface/wifi' },
          { label: 'configuration', path: '/interface/wifi/configuration' },
          { label: 'security', path: '/interface/wifi/security' },
          { label: 'datapath', path: '/interface/wifi/datapath' },
          { label: 'provisioning', path: '/interface/wifi/provisioning' },
          { label: 'capsman', path: '/interface/wifi/capsman' },
          { label: 'cap', path: '/interface/wifi/cap' },
          { label: 'access-list', path: '/interface/wifi/access-list' },
          { label: 'registration-table', path: '/interface/wifi/registration-table' },
        ],
      },
      { label: 'bonding', path: '/interface/bonding' },
      { label: 'wireguard', path: '/interface/wireguard' },
      { label: 'gre', path: '/interface/gre' },
      { label: 'eoip', path: '/interface/eoip' },
      { label: 'ipip', path: '/interface/ipip' },
      { label: 'pppoe-client', path: '/interface/pppoe-client' },
      { label: 'pppoe-server', path: '/interface/pppoe-server/server' },
      { label: 'l2tp-server', path: '/interface/l2tp-server/server' },
      { label: 'sstp-server', path: '/interface/sstp-server/server' },
      { label: 'ovpn-server', path: '/interface/ovpn-server/server' },
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
      {
        label: 'dhcp-server',
        path: '/ip/dhcp-server',
        children: [
          { label: 'dhcp-server', path: '/ip/dhcp-server' },
          { label: 'network', path: '/ip/dhcp-server/network' },
          { label: 'lease', path: '/ip/dhcp-server/lease' },
        ],
      },
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
      {
        label: 'ipsec',
        path: '/ip/ipsec',
        children: [
          { label: 'peer', path: '/ip/ipsec/peer' },
          { label: 'identity', path: '/ip/ipsec/identity' },
          { label: 'policy', path: '/ip/ipsec/policy' },
          { label: 'proposal', path: '/ip/ipsec/proposal' },
          { label: 'profile', path: '/ip/ipsec/profile' },
          { label: 'active-peers', path: '/ip/ipsec/active-peers' },
          { label: 'installed-sa', path: '/ip/ipsec/installed-sa' },
        ],
      },
      { label: 'pool', path: '/ip/pool' },
      { label: 'service', path: '/ip/service' },
      { label: 'neighbor', path: '/ip/neighbor' },
      { label: 'arp', path: '/ip/arp' },
    ],
  },
  {
    label: 'ipv6',
    path: '/ipv6',
    children: [
      { label: 'address', path: '/ipv6/address' },
      { label: 'route', path: '/ipv6/route' },
      {
        label: 'firewall',
        path: '/ipv6/firewall',
        children: [
          { label: 'filter', path: '/ipv6/firewall/filter' },
          { label: 'mangle', path: '/ipv6/firewall/mangle' },
          { label: 'raw', path: '/ipv6/firewall/raw' },
          { label: 'address-list', path: '/ipv6/firewall/address-list' },
        ],
      },
      { label: 'nd', path: '/ipv6/nd' },
      { label: 'pool', path: '/ipv6/pool' },
      { label: 'dhcp-client', path: '/ipv6/dhcp-client' },
    ],
  },
  {
    label: 'caps-man',
    path: '/caps-man',
    children: [
      { label: 'interface', path: '/caps-man/interface' },
      { label: 'configuration', path: '/caps-man/configuration' },
      { label: 'provisioning', path: '/caps-man/provisioning' },
      { label: 'datapath', path: '/caps-man/datapath' },
      { label: 'security', path: '/caps-man/security' },
      { label: 'channel', path: '/caps-man/channel' },
      { label: 'access-list', path: '/caps-man/access-list' },
      { label: 'registration-table', path: '/caps-man/registration-table' },
    ],
  },
  {
    label: 'ppp',
    path: '/ppp',
    children: [
      { label: 'profile', path: '/ppp/profile' },
      { label: 'secret', path: '/ppp/secret' },
      { label: 'active', path: '/ppp/active' },
    ],
  },
  {
    label: 'system',
    path: '/system',
    children: [
      { label: 'identity', path: '/system/identity' },
      { label: 'clock', path: '/system/clock' },
      {
        label: 'ntp',
        path: '/system/ntp',
        children: [
          { label: 'client', path: '/system/ntp/client' },
          { label: 'server', path: '/system/ntp/server' },
        ],
      },
      { label: 'resource', path: '/system/resource' },
      { label: 'routerboard', path: '/system/routerboard' },
      { label: 'health', path: '/system/health' },
      { label: 'note', path: '/system/note' },
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
      { label: 'e-mail', path: '/tool/e-mail' },
      { label: 'graphing', path: '/tool/graphing' },
      { label: 'netwatch', path: '/tool/netwatch' },
      { label: 'sniffer', path: '/tool/sniffer' },
      { label: 'romon', path: '/tool/romon' },
    ],
  },
  { label: 'user', path: '/user' },
  { label: 'snmp', path: '/snmp' },
  { label: 'certificate', path: '/certificate' },
  { label: 'container', path: '/container' },
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
            ? 'bg-[hsl(var(--accent-soft))] text-accent'
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
        <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-1">Menu</div>
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
        <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-1">Custom path</div>
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
