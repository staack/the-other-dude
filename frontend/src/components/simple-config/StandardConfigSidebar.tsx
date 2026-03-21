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
      { id: 'wireless', label: 'Wireless' },
      { id: 'stations', label: 'Stations' },
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
    items: [{ id: 'wifi', label: 'WiFi Config' }],
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
    <div className="w-44 flex-shrink-0 flex flex-col min-h-[400px]">
      <nav className="space-y-2 overflow-y-auto flex-1">
        {STANDARD_GROUPS.map((group) => {
          const GroupIcon = group.icon
          return (
            <div key={group.label}>
              <p className="flex items-center gap-1.5 text-[7px] text-text-label uppercase tracking-[2px] mb-1 pl-2">
                <GroupIcon className="h-3 w-3" />
                {group.label}
              </p>
              <div>
                {group.items.map((item) => {
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      data-testid={`tab-${item.id}`}
                      className={cn(
                        'flex items-center w-full text-left pl-6 pr-2 py-[3px] text-xs border-l-2 transition-[border-color,color] duration-[50ms]',
                        isActive
                          ? 'bg-accent-soft text-text-primary font-medium border-accent rounded-r-sm'
                          : 'text-text-secondary hover:border-accent border-transparent',
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
        <div className="mt-auto pt-2 border-t border-border-subtle">
          <button
            onClick={onSwitchToSimple}
            className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-[10px] text-text-muted hover:text-text-secondary transition-[color] duration-[50ms]"
          >
            <Sliders className="h-3 w-3" />
            Simple mode
          </button>
        </div>
      )}
    </div>
  )
}
