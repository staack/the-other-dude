/**
 * Simple Configuration Interface - Declarative Category Schema
 *
 * Maps 7 simplified configuration categories to RouterOS paths,
 * field definitions, and friendly labels. Consumed by all Simple
 * mode category panels and the category sidebar.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Globe,
  Network,
  Wifi,
  ArrowLeftRight,
  Shield,
  Server,
  Settings,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimpleCategory {
  id: string
  label: string
  icon: LucideIcon
  description: string
  sections: SimpleCategorySection[]
}

export interface SimpleCategorySection {
  label: string
  routerosPath: string
  isSingleton: boolean
  fields: SimpleFieldDef[]
}

export interface SimpleFieldDef {
  key: string
  label: string
  type: 'text' | 'ip' | 'cidr' | 'number' | 'boolean' | 'select' | 'password'
  help?: string
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
  validation?: (value: string) => string | null
  minVersion?: number
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/

export function isValidIp(value: string): boolean {
  if (!value) return false
  if (IPV4_REGEX.test(value)) {
    return value.split('.').every((octet) => {
      const n = parseInt(octet, 10)
      return n >= 0 && n <= 255
    })
  }
  return IPV6_REGEX.test(value)
}

export function isValidCidr(value: string): boolean {
  if (!value) return false
  const parts = value.split('/')
  if (parts.length !== 2) return false
  const [ip, prefix] = parts
  if (!isValidIp(ip)) return false
  const prefixNum = parseInt(prefix, 10)
  if (isNaN(prefixNum)) return false
  // IPv4: 0-32, IPv6: 0-128
  const maxPrefix = ip.includes(':') ? 128 : 32
  return prefixNum >= 0 && prefixNum <= maxPrefix
}

export function isValidPort(value: string): boolean {
  const n = parseInt(value, 10)
  return !isNaN(n) && n >= 1 && n <= 65535
}

// ---------------------------------------------------------------------------
// Category Definitions
// ---------------------------------------------------------------------------

export const SIMPLE_CATEGORIES: SimpleCategory[] = [
  {
    id: 'internet',
    label: 'Internet Setup',
    icon: Globe,
    description: 'Configure how this router connects to the internet',
    sections: [
      {
        label: 'DHCP Client',
        routerosPath: '/ip/dhcp-client',
        isSingleton: false,
        fields: [
          { key: 'interface', label: 'WAN Interface', type: 'select', required: true },
          { key: 'use-peer-dns', label: 'Use ISP DNS', type: 'boolean', help: 'Accept DNS servers from your ISP' },
          { key: 'use-peer-ntp', label: 'Use ISP NTP', type: 'boolean', help: 'Accept time servers from your ISP' },
          { key: 'add-default-route', label: 'Add Default Route', type: 'boolean', help: 'Automatically create a default route via this connection' },
        ],
      },
      {
        label: 'PPPoE Client',
        routerosPath: '/interface/pppoe-client',
        isSingleton: false,
        fields: [
          { key: 'interface', label: 'Interface', type: 'select', required: true },
          { key: 'user', label: 'PPPoE Username', type: 'text', required: true, placeholder: 'ISP username' },
          { key: 'password', label: 'PPPoE Password', type: 'password', required: true },
          { key: 'service-name', label: 'Service Name', type: 'text', placeholder: 'Optional' },
          { key: 'use-peer-dns', label: 'Use ISP DNS', type: 'boolean' },
        ],
      },
      {
        label: 'Static IP',
        routerosPath: '/ip/address',
        isSingleton: false,
        fields: [
          { key: 'address', label: 'IP Address / Mask', type: 'cidr', required: true, placeholder: '192.168.1.100/24' },
          { key: 'interface', label: 'WAN Interface', type: 'select', required: true },
        ],
      },
    ],
  },
  {
    id: 'lan',
    label: 'LAN & DHCP',
    icon: Network,
    description: 'Local network addresses, DHCP server, and IP pools',
    sections: [
      {
        label: 'LAN Address',
        routerosPath: '/ip/address',
        isSingleton: false,
        fields: [
          { key: 'address', label: 'IP Address / Mask', type: 'cidr', required: true, placeholder: '192.168.88.1/24', help: 'The IP address of this router on the local network' },
          { key: 'interface', label: 'Interface', type: 'text' },
        ],
      },
      {
        label: 'DHCP Server',
        routerosPath: '/ip/dhcp-server',
        isSingleton: false,
        fields: [
          { key: 'disabled', label: 'Enabled', type: 'boolean', help: 'Enable or disable the DHCP server' },
          { key: 'address-pool', label: 'Address Pool', type: 'text' },
        ],
      },
      {
        label: 'DHCP Network',
        routerosPath: '/ip/dhcp-server/network',
        isSingleton: false,
        fields: [
          { key: 'gateway', label: 'Gateway', type: 'ip', placeholder: '192.168.88.1' },
          { key: 'dns-server', label: 'DNS Servers', type: 'text', placeholder: '192.168.88.1', help: 'DNS servers provided to DHCP clients' },
          { key: 'lease-time', label: 'Lease Time', type: 'text', placeholder: '10m', help: 'How long a DHCP lease is valid' },
        ],
      },
      {
        label: 'Address Pool',
        routerosPath: '/ip/pool',
        isSingleton: false,
        fields: [
          { key: 'ranges', label: 'IP Range', type: 'text', placeholder: '192.168.88.10-192.168.88.254', help: 'Range of IP addresses for DHCP clients' },
        ],
      },
    ],
  },
  {
    id: 'wifi',
    label: 'WiFi',
    icon: Wifi,
    description: 'Wireless network names, passwords, and bands',
    sections: [
      {
        label: 'Wireless Interface',
        routerosPath: '/interface/wifi',
        isSingleton: false,
        fields: [
          { key: 'ssid', label: 'Network Name (SSID)', type: 'text', required: true, placeholder: 'MyNetwork' },
          { key: 'security.passphrase', label: 'Password', type: 'password', required: true, help: 'WPA2/WPA3 passphrase (min 8 characters)' },
          { key: 'configuration.band', label: 'Band', type: 'select', options: [
            { value: '2ghz-ax', label: '2.4 GHz' },
            { value: '5ghz-ax', label: '5 GHz' },
          ] },
          { key: 'disabled', label: 'Enabled', type: 'boolean' },
        ],
      },
    ],
  },
  {
    id: 'port-forwarding',
    label: 'Port Forwarding',
    icon: ArrowLeftRight,
    description: 'Forward external ports to internal servers',
    sections: [
      {
        label: 'NAT Rules',
        routerosPath: '/ip/firewall/nat',
        isSingleton: false,
        fields: [
          { key: 'dst-port', label: 'External Port', type: 'number', required: true, placeholder: '80', validation: (v) => isValidPort(v) ? null : 'Port must be 1-65535' },
          { key: 'protocol', label: 'Protocol', type: 'select', required: true, options: [
            { value: 'tcp', label: 'TCP' },
            { value: 'udp', label: 'UDP' },
            { value: '6', label: 'TCP + UDP' },
          ] },
          { key: 'to-addresses', label: 'Internal IP Address', type: 'ip', required: true, placeholder: '192.168.88.100' },
          { key: 'to-ports', label: 'Internal Port', type: 'number', required: true, placeholder: '80', help: 'Leave same as external port if unchanged' },
          { key: 'comment', label: 'Description', type: 'text', placeholder: 'e.g., Web Server' },
        ],
      },
    ],
  },
  {
    id: 'firewall',
    label: 'Firewall',
    icon: Shield,
    description: 'Basic firewall rules and address lists',
    sections: [
      {
        label: 'Filter Rules',
        routerosPath: '/ip/firewall/filter',
        isSingleton: false,
        fields: [
          { key: 'chain', label: 'Chain', type: 'select', required: true, options: [
            { value: 'input', label: 'Input' },
            { value: 'forward', label: 'Forward' },
          ] },
          { key: 'action', label: 'Action', type: 'select', required: true, options: [
            { value: 'accept', label: 'Accept' },
            { value: 'drop', label: 'Drop' },
            { value: 'reject', label: 'Reject' },
          ] },
          { key: 'protocol', label: 'Protocol', type: 'select', options: [
            { value: 'tcp', label: 'TCP' },
            { value: 'udp', label: 'UDP' },
            { value: 'icmp', label: 'ICMP' },
          ] },
          { key: 'dst-port', label: 'Destination Port', type: 'number', placeholder: '22' },
          { key: 'src-address', label: 'Source Address', type: 'text', placeholder: '192.168.88.0/24', help: 'Leave blank to match any source' },
          { key: 'comment', label: 'Comment', type: 'text', placeholder: 'e.g., Allow SSH from LAN' },
        ],
      },
      {
        label: 'Address Lists',
        routerosPath: '/ip/firewall/address-list',
        isSingleton: false,
        fields: [
          { key: 'list', label: 'List Name', type: 'text', required: true },
          { key: 'address', label: 'Address', type: 'text', required: true, placeholder: '192.168.88.0/24' },
          { key: 'comment', label: 'Comment', type: 'text' },
        ],
      },
    ],
  },
  {
    id: 'dns',
    label: 'DNS',
    icon: Server,
    description: 'DNS servers and local name resolution',
    sections: [
      {
        label: 'DNS Settings',
        routerosPath: '/ip/dns',
        isSingleton: true,
        fields: [
          { key: 'servers', label: 'Upstream Servers', type: 'text', required: true, placeholder: '8.8.8.8,8.8.4.4', help: 'Comma-separated list of DNS server IPs used for name resolution' },
          { key: 'allow-remote-requests', label: 'Allow Remote Requests', type: 'boolean', help: 'Allow devices on your network to use this router as their DNS server' },
          { key: 'cache-size', label: 'Cache Size (KiB)', type: 'number', placeholder: '2048', help: 'DNS cache size in KiB' },
        ],
      },
      {
        label: 'Static Entries',
        routerosPath: '/ip/dns/static',
        isSingleton: false,
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'myserver.local' },
          { key: 'address', label: 'Address', type: 'ip', required: true, placeholder: '192.168.88.100' },
          { key: 'type', label: 'Type', type: 'select', options: [
            { value: 'A', label: 'A' },
            { value: 'AAAA', label: 'AAAA' },
            { value: 'CNAME', label: 'CNAME' },
          ] },
        ],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    description: 'Device identity, time, passwords, and maintenance',
    sections: [
      {
        label: 'Identity',
        routerosPath: '/system/identity',
        isSingleton: true,
        fields: [
          { key: 'name', label: 'Hostname', type: 'text', required: true, placeholder: 'e.g., Office-Router-1', help: 'A friendly name for this router, visible in the fleet dashboard' },
        ],
      },
      {
        label: 'Clock',
        routerosPath: '/system/clock',
        isSingleton: true,
        fields: [
          { key: 'time-zone-name', label: 'Timezone', type: 'text', placeholder: 'America/New_York', help: 'IANA timezone identifier (e.g., America/New_York, Europe/London)' },
        ],
      },
      {
        label: 'NTP Client',
        routerosPath: '/system/ntp/client',
        isSingleton: true,
        fields: [
          { key: 'enabled', label: 'NTP Enabled', type: 'boolean' },
          { key: 'server-dns-names', label: 'NTP Servers', type: 'text', placeholder: 'pool.ntp.org', help: 'Comma-separated NTP server hostnames' },
        ],
      },
      {
        label: 'System Resource',
        routerosPath: '/system/resource',
        isSingleton: true,
        fields: [],
      },
    ],
  },
]
