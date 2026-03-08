/**
 * StandardConfigSidebar -- WinBox-style vertical navigation for Standard mode.
 *
 * Groups 31 tabs into 10 categories mirroring WinBox's tree menu.
 * Uses the same accent-left-border styling as SimpleConfigSidebar.
 */

import {
  Activity,
  Network,
  Globe,
  Shield,
  Wifi,
  Gauge,
  Lock,
  Settings,
  Wrench,
  FolderCog,
  Sliders,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarGroup {
  label: string
  icon: LucideIcon
  items: { id: string; label: string }[]
}

const STANDARD_GROUPS: SidebarGroup[] = [
  {
    label: 'Monitor',
    icon: Activity,
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'health', label: 'Health' },
      { id: 'traffic', label: 'Traffic' },
    ],
  },
  {
    label: 'Interfaces',
    icon: Network,
    items: [
      { id: 'interfaces', label: 'Interfaces' },
      { id: 'ports', label: 'Ports' },
      { id: 'bridge-ports', label: 'Bridge Ports' },
      { id: 'bridge-vlans', label: 'VLANs' },
    ],
  },
  {
    label: 'IP',
    icon: Globe,
    items: [
      { id: 'addresses', label: 'Addresses' },
      { id: 'routes', label: 'Routes' },
      { id: 'arp', label: 'ARP' },
      { id: 'pools', label: 'Pools' },
      { id: 'dns', label: 'DNS' },
      { id: 'dhcp', label: 'DHCP Server' },
      { id: 'dhcp-client', label: 'DHCP Client' },
    ],
  },
  {
    label: 'Firewall',
    icon: Shield,
    items: [
      { id: 'firewall', label: 'Firewall' },
      { id: 'mangle', label: 'Mangle' },
      { id: 'addr-lists', label: 'Addr Lists' },
      { id: 'conntrack', label: 'ConnTrack' },
    ],
  },
  {
    label: 'WiFi',
    icon: Wifi,
    items: [{ id: 'wifi', label: 'WiFi' }],
  },
  {
    label: 'Queues',
    icon: Gauge,
    items: [{ id: 'queues', label: 'Queues' }],
  },
  {
    label: 'VPN',
    icon: Lock,
    items: [
      { id: 'ppp', label: 'PPP' },
      { id: 'ipsec', label: 'IPsec' },
      { id: 'vpn', label: 'VPN' },
    ],
  },
  {
    label: 'System',
    icon: Settings,
    items: [
      { id: 'system', label: 'System' },
      { id: 'users', label: 'Users' },
      { id: 'services', label: 'Services' },
      { id: 'scripts', label: 'Scripts' },
      { id: 'snmp', label: 'SNMP' },
    ],
  },
  {
    label: 'Tools',
    icon: Wrench,
    items: [
      { id: 'net-tools', label: 'Tools' },
      { id: 'clients', label: 'Clients' },
      { id: 'logs', label: 'Logs' },
    ],
  },
  {
    label: 'Manage',
    icon: FolderCog,
    items: [
      { id: 'config', label: 'Config' },
      { id: 'alerts', label: 'Alerts' },
    ],
  },
]

interface StandardConfigSidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  onSwitchToSimple?: () => void
}

export function StandardConfigSidebar({
  activeTab,
  onTabChange,
  onSwitchToSimple,
}: StandardConfigSidebarProps) {
  return (
    <div className="w-48 flex-shrink-0 flex flex-col min-h-[400px]">
      <nav className="space-y-3 overflow-y-auto flex-1">
        {STANDARD_GROUPS.map((group) => {
          const GroupIcon = group.icon
          return (
            <div key={group.label}>
              <p className="flex items-center gap-1.5 text-xs font-medium text-text-muted uppercase tracking-wider mb-1 px-3">
                <GroupIcon className="h-3 w-3" />
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      data-testid={`tab-${item.id}`}
                      className={cn(
                        'flex items-center w-full text-left pl-7 pr-3 py-1.5 rounded-r-lg text-sm transition-colors',
                        isActive
                          ? 'bg-accent/10 text-accent border-l-2 border-accent'
                          : 'text-text-secondary hover:text-text-primary hover:bg-elevated/50 border-l-2 border-transparent',
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {onSwitchToSimple && (
        <div className="mt-auto pt-4 border-t border-border/50">
          <button
            onClick={onSwitchToSimple}
            className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <Sliders className="h-3.5 w-3.5" />
            Switch to Simple mode
          </button>
        </div>
      )}
    </div>
  )
}
