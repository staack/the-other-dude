/**
 * Shared types and utilities for all config panel components.
 *
 * Every config panel (Interfaces, Firewall, DNS, DHCP, WiFi, Queues)
 * imports these types to ensure a consistent change model and apply workflow.
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/** Apply mode: 'quick' (Standard Apply) executes add/set/remove directly; 'safe' (Safe Apply with auto-revert) generates an RSC script */
export type ApplyMode = 'quick' | 'safe'

/** A single pending configuration change to be previewed and applied */
export interface ConfigChange {
  /** The operation to perform */
  operation: 'add' | 'set' | 'remove'
  /** RouterOS menu path, e.g. '/ip/address' */
  path: string
  /** Entry ID for set/remove operations (the RouterOS .id value) */
  entryId?: string
  /** Properties for add/set operations */
  properties: Record<string, string>
  /** Human-friendly description, e.g. "Add IP 192.168.1.1/24 to ether1" */
  description: string
}

/** Standard props passed to every config panel tab component */
export interface ConfigPanelProps {
  tenantId: string
  deviceId: string
  /** TanStack Query enabled guard -- only fetch data when the tab is active */
  active: boolean
}

/** Field definition for dynamic form generation in config panels */
export interface PanelField {
  /** RouterOS property name */
  key: string
  /** Human-friendly label */
  label: string
  /** Field type for form rendering */
  type: 'text' | 'number' | 'boolean' | 'select'
  /** Select options (only used when type='select') */
  options?: string[]
  /** Whether the field is required */
  required?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Help text shown below the field */
  help?: string
}

/** Function signature for RSC script generators */
export type RscScriptGenerator = (changes: ConfigChange[]) => string

// ---------------------------------------------------------------------------
// Default Apply Modes
// ---------------------------------------------------------------------------

/**
 * Default apply mode per panel type.
 *
 * High-risk panels (interfaces, firewall) default to 'safe' mode.
 * Lower-risk panels (dns, dhcp, wifi, queues) default to 'quick' mode.
 */
export const DEFAULT_APPLY_MODES: Record<string, ApplyMode> = {
  interfaces: 'safe',
  firewall: 'safe',
  dns: 'quick',
  dhcp: 'quick',
  'dhcp-client': 'safe',
  wifi: 'quick',
  queues: 'quick',
  // Phase 19: Routing & Addressing
  routes: 'safe',
  addresses: 'safe',
  arp: 'quick',
  pools: 'quick',
  // Phase 20: System Configuration
  system: 'safe',
  users: 'safe',
  services: 'safe',
  scripts: 'quick',
  // Phase 21: Advanced Firewall & Security
  mangle: 'safe',
  'address-lists': 'quick',
  conntrack: 'safe',
  // Phase 22: VPN & PPP Management
  ppp: 'safe',
  ipsec: 'safe',
  // Phase 24: Bridge & VLAN Deep Config
  'bridge-ports': 'safe',
  'bridge-vlans': 'safe',
  snmp: 'quick',
  // Phase 27: Simple Configuration Interface
  'simple-internet': 'safe',
  'simple-lan': 'safe',
  'simple-wifi': 'quick',
  'simple-port-forwarding': 'safe',
  'simple-firewall': 'safe',
  'simple-dns': 'quick',
  'simple-system': 'safe',
}

// ---------------------------------------------------------------------------
// RSC Script Generator
// ---------------------------------------------------------------------------

/**
 * Converts an array of ConfigChange objects into a RouterOS RSC script string.
 *
 * Output example:
 *   /ip address add address=192.168.1.1/24 interface=ether1
 *   /ip firewall filter set [find where .id="*1"] disabled=yes
 *   /ip address remove [find where .id="*2"]
 */
export function generateRscScript(changes: ConfigChange[]): string {
  return changes
    .map((change) => {
      const props = Object.entries(change.properties)
        .map(([k, v]) => `${k}=${quoteIfNeeded(v)}`)
        .join(' ')

      switch (change.operation) {
        case 'add':
          return `${change.path} add ${props}`.trim()
        case 'set': {
          const selector = change.entryId
            ? `[find where .id="${change.entryId}"]`
            : ''
          return `${change.path} set ${selector} ${props}`.trim()
        }
        case 'remove': {
          const selector = change.entryId
            ? `[find where .id="${change.entryId}"]`
            : ''
          return `${change.path} remove ${selector}`.trim()
        }
      }
    })
    .join('\n')
}

/**
 * Quotes a value if it contains spaces or special characters.
 */
function quoteIfNeeded(value: string): string {
  if (/[\s"\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

// ---------------------------------------------------------------------------
// Change Description Generator
// ---------------------------------------------------------------------------

/**
 * Converts an array of ConfigChange objects into human-readable descriptions.
 * Used in the ChangePreviewModal for Standard Apply mode.
 */
export function describeChanges(changes: ConfigChange[]): string[] {
  return changes.map((change, index) => `${index + 1}. ${change.description}`)
}
