/**
 * SimpleConfigView -- Mode-aware wrapper that renders either the Simple
 * category sidebar + panel content or the Standard vertical sidebar.
 *
 * Both modes use a vertical sidebar + conditional content panel layout.
 * Standard mode groups 31 panels into WinBox-style categories.
 * Simple mode shows 7 simplified configuration categories.
 */

import { useState } from 'react'
import type { DeviceResponse } from '@/lib/api'
import { SimpleConfigSidebar } from './SimpleConfigSidebar'
import { StandardConfigSidebar } from './StandardConfigSidebar'

// Simple mode category panel imports
import { InternetSetupPanel } from './categories/InternetSetupPanel'
import { LanDhcpPanel } from './categories/LanDhcpPanel'
import { DnsSimplePanel } from './categories/DnsSimplePanel'
import { WifiSimplePanel } from './categories/WifiSimplePanel'
import { PortForwardingPanel } from './categories/PortForwardingPanel'
import { FirewallBasicsPanel } from './categories/FirewallBasicsPanel'
import { SystemSimplePanel } from './categories/SystemSimplePanel'

// Standard config panel imports
import { HealthTab } from '@/components/monitoring/HealthTab'
import { WirelessTab } from '@/components/monitoring/WirelessTab'
import { InterfacesTab } from '@/components/monitoring/InterfacesTab'
import { ConfigTab } from '@/components/config/ConfigTab'
import { InterfacesPanel } from '@/components/config/InterfacesPanel'
import { SwitchPortManager } from '@/components/config/SwitchPortManager'
import { FirewallPanel } from '@/components/config/FirewallPanel'
import { DnsPanel } from '@/components/config/DnsPanel'
import { DhcpPanel } from '@/components/config/DhcpPanel'
import { DhcpClientPanel } from '@/components/config/DhcpClientPanel'
import { WifiPanel } from '@/components/config/WifiPanel'
import { QueuesPanel } from '@/components/config/QueuesPanel'
import { RoutesPanel } from '@/components/config/RoutesPanel'
import { AddressPanel } from '@/components/config/AddressPanel'
import { ArpPanel } from '@/components/config/ArpPanel'
import { PoolPanel } from '@/components/config/PoolPanel'
import { SystemPanel } from '@/components/config/SystemPanel'
import { UsersPanel } from '@/components/config/UsersPanel'
import { ServicesPanel } from '@/components/config/ServicesPanel'
import { ScriptsPanel } from '@/components/config/ScriptsPanel'
import { ManglePanel } from '@/components/config/ManglePanel'
import { AddressListPanel } from '@/components/config/AddressListPanel'
import { ConnTrackPanel } from '@/components/config/ConnTrackPanel'
import { PppPanel } from '@/components/config/PppPanel'
import { IpsecPanel } from '@/components/config/IpsecPanel'
import { NetworkToolsPanel } from '@/components/config/NetworkToolsPanel'
import { BridgePortPanel } from '@/components/config/BridgePortPanel'
import { BridgeVlanPanel } from '@/components/config/BridgeVlanPanel'
import { SnmpPanel } from '@/components/config/SnmpPanel'
import { ClientsTab } from '@/components/network/ClientsTab'
import { VpnTab } from '@/components/network/VpnTab'
import { LogsTab } from '@/components/network/LogsTab'
import { WirelessStationTable } from '@/components/wireless/WirelessStationTable'
import { RFStatsCard } from '@/components/wireless/RFStatsCard'

interface SimpleConfigViewProps {
  tenantId: string
  deviceId: string
  device: DeviceResponse
  mode: 'simple' | 'standard'
  activeTab: string
  onTabChange: (tab: string) => void
  onModeChange: (mode: 'simple' | 'standard') => void
  /** Render slot for the overview tab content (passed from device detail page) */
  overviewContent: React.ReactNode
  /** Render slot for the alerts tab content */
  alertsContent: React.ReactNode
}

export function SimpleConfigView({
  tenantId,
  deviceId,
  device,
  mode,
  activeTab,
  onTabChange,
  onModeChange,
  overviewContent,
  alertsContent,
}: SimpleConfigViewProps) {
  const [activeCategory, setActiveCategory] = useState('internet')

  // -------------------------------------------------------------------------
  // Standard Mode — WinBox-style vertical sidebar + content panel
  // -------------------------------------------------------------------------
  if (mode === 'standard') {
    return (
      <div className="flex gap-6">
        <StandardConfigSidebar
          activeTab={activeTab}
          onTabChange={onTabChange}
          onSwitchToSimple={() => onModeChange('simple')}
        />

        <div className="flex-1 min-w-0" key={activeTab}>
          {activeTab === 'overview' && (
            <div className="space-y-4">{overviewContent}</div>
          )}
          {activeTab === 'health' && (
            <HealthTab tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'traffic' && (
            <InterfacesTab tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'wireless' && (
            <WirelessTab tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'stations' && (
            <div className="space-y-4">
              <WirelessStationTable tenantId={tenantId} deviceId={deviceId} active />
              <RFStatsCard tenantId={tenantId} deviceId={deviceId} active />
            </div>
          )}
          {activeTab === 'interfaces' && (
            <InterfacesPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'ports' && (
            <SwitchPortManager tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'firewall' && (
            <FirewallPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'dhcp' && (
            <DhcpPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'dhcp-client' && (
            <DhcpClientPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'dns' && (
            <DnsPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'wifi' && (
            <WifiPanel tenantId={tenantId} deviceId={deviceId} active routerosVersion={device.routeros_version} />
          )}
          {activeTab === 'queues' && (
            <QueuesPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'routes' && (
            <RoutesPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'addresses' && (
            <AddressPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'arp' && (
            <ArpPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'pools' && (
            <PoolPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'system' && (
            <SystemPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'users' && (
            <UsersPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'services' && (
            <ServicesPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'scripts' && (
            <ScriptsPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'mangle' && (
            <ManglePanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'addr-lists' && (
            <AddressListPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'conntrack' && (
            <ConnTrackPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'ppp' && (
            <PppPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'ipsec' && (
            <IpsecPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'net-tools' && (
            <NetworkToolsPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'bridge-ports' && (
            <BridgePortPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'bridge-vlans' && (
            <BridgeVlanPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'snmp' && (
            <SnmpPanel tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'clients' && (
            <ClientsTab tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'vpn' && (
            <VpnTab tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'logs' && (
            <LogsTab tenantId={tenantId} deviceId={deviceId} active />
          )}
          {activeTab === 'config' && (
            <ConfigTab
              tenantId={tenantId}
              deviceId={deviceId}
              deviceHostname={device.hostname}
              active
            />
          )}
          {activeTab === 'alerts' && alertsContent}
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Simple Mode — vertical sidebar + category panels
  // -------------------------------------------------------------------------
  return (
    <div className="flex gap-6">
      <SimpleConfigSidebar
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onSwitchToStandard={() => onModeChange('standard')}
      />

      <div className="flex-1 min-w-0 max-w-2xl" key={activeCategory}>
        {activeCategory === 'internet' && (
          <InternetSetupPanel tenantId={tenantId} deviceId={deviceId} active />
        )}
        {activeCategory === 'lan' && (
          <LanDhcpPanel tenantId={tenantId} deviceId={deviceId} active />
        )}
        {activeCategory === 'wifi' && (
          <WifiSimplePanel tenantId={tenantId} deviceId={deviceId} active routerosVersion={device.routeros_version} />
        )}
        {activeCategory === 'port-forwarding' && (
          <PortForwardingPanel tenantId={tenantId} deviceId={deviceId} active />
        )}
        {activeCategory === 'firewall' && (
          <FirewallBasicsPanel tenantId={tenantId} deviceId={deviceId} active />
        )}
        {activeCategory === 'dns' && (
          <DnsSimplePanel tenantId={tenantId} deviceId={deviceId} active />
        )}
        {activeCategory === 'system' && (
          <SystemSimplePanel tenantId={tenantId} deviceId={deviceId} active />
        )}
      </div>
    </div>
  )
}
