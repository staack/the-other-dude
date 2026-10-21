/**
 * SimpleConfigView -- Mode-aware wrapper that renders either the Simple
 * category sidebar + panel content or the Standard vertical sidebar.
 *
 * Both modes use a vertical sidebar + conditional content panel layout.
 * Standard mode groups 31 panels into WinBox-style categories.
 * Simple mode shows 7 simplified configuration categories.
 */

import { lazy, Suspense, useState } from 'react'
import type { DeviceResponse } from '@/lib/api'
import { SimpleConfigSidebar } from './SimpleConfigSidebar'
import { StandardConfigSidebar } from './StandardConfigSidebar'

// Simple mode category panel imports
const InternetSetupPanel = lazy(() => import('./categories/InternetSetupPanel').then(m => ({ default: m.InternetSetupPanel })))
const LanDhcpPanel = lazy(() => import('./categories/LanDhcpPanel').then(m => ({ default: m.LanDhcpPanel })))
const DnsSimplePanel = lazy(() => import('./categories/DnsSimplePanel').then(m => ({ default: m.DnsSimplePanel })))
const WifiSimplePanel = lazy(() => import('./categories/WifiSimplePanel').then(m => ({ default: m.WifiSimplePanel })))
const PortForwardingPanel = lazy(() => import('./categories/PortForwardingPanel').then(m => ({ default: m.PortForwardingPanel })))
const FirewallBasicsPanel = lazy(() => import('./categories/FirewallBasicsPanel').then(m => ({ default: m.FirewallBasicsPanel })))
const SystemSimplePanel = lazy(() => import('./categories/SystemSimplePanel').then(m => ({ default: m.SystemSimplePanel })))

// Standard config panel imports
const HealthTab = lazy(() => import('@/components/monitoring/HealthTab').then(m => ({ default: m.HealthTab })))
const WirelessTab = lazy(() => import('@/components/monitoring/WirelessTab').then(m => ({ default: m.WirelessTab })))
const InterfacesTab = lazy(() => import('@/components/monitoring/InterfacesTab').then(m => ({ default: m.InterfacesTab })))
const ConfigTab = lazy(() => import('@/components/config/ConfigTab').then(m => ({ default: m.ConfigTab })))
const InterfacesPanel = lazy(() => import('@/components/config/InterfacesPanel').then(m => ({ default: m.InterfacesPanel })))
const SwitchPortManager = lazy(() => import('@/components/config/SwitchPortManager').then(m => ({ default: m.SwitchPortManager })))
const FirewallPanel = lazy(() => import('@/components/config/FirewallPanel').then(m => ({ default: m.FirewallPanel })))
const DnsPanel = lazy(() => import('@/components/config/DnsPanel').then(m => ({ default: m.DnsPanel })))
const DhcpPanel = lazy(() => import('@/components/config/DhcpPanel').then(m => ({ default: m.DhcpPanel })))
const DhcpClientPanel = lazy(() => import('@/components/config/DhcpClientPanel').then(m => ({ default: m.DhcpClientPanel })))
const WifiPanel = lazy(() => import('@/components/config/WifiPanel').then(m => ({ default: m.WifiPanel })))
const QueuesPanel = lazy(() => import('@/components/config/QueuesPanel').then(m => ({ default: m.QueuesPanel })))
const RoutesPanel = lazy(() => import('@/components/config/RoutesPanel').then(m => ({ default: m.RoutesPanel })))
const AddressPanel = lazy(() => import('@/components/config/AddressPanel').then(m => ({ default: m.AddressPanel })))
const ArpPanel = lazy(() => import('@/components/config/ArpPanel').then(m => ({ default: m.ArpPanel })))
const PoolPanel = lazy(() => import('@/components/config/PoolPanel').then(m => ({ default: m.PoolPanel })))
const SystemPanel = lazy(() => import('@/components/config/SystemPanel').then(m => ({ default: m.SystemPanel })))
const UsersPanel = lazy(() => import('@/components/config/UsersPanel').then(m => ({ default: m.UsersPanel })))
const ServicesPanel = lazy(() => import('@/components/config/ServicesPanel').then(m => ({ default: m.ServicesPanel })))
const ScriptsPanel = lazy(() => import('@/components/config/ScriptsPanel').then(m => ({ default: m.ScriptsPanel })))
const ManglePanel = lazy(() => import('@/components/config/ManglePanel').then(m => ({ default: m.ManglePanel })))
const AddressListPanel = lazy(() => import('@/components/config/AddressListPanel').then(m => ({ default: m.AddressListPanel })))
const ConnTrackPanel = lazy(() => import('@/components/config/ConnTrackPanel').then(m => ({ default: m.ConnTrackPanel })))
const PppPanel = lazy(() => import('@/components/config/PppPanel').then(m => ({ default: m.PppPanel })))
const IpsecPanel = lazy(() => import('@/components/config/IpsecPanel').then(m => ({ default: m.IpsecPanel })))
const NetworkToolsPanel = lazy(() => import('@/components/config/NetworkToolsPanel').then(m => ({ default: m.NetworkToolsPanel })))
const BridgePortPanel = lazy(() => import('@/components/config/BridgePortPanel').then(m => ({ default: m.BridgePortPanel })))
const BridgeVlanPanel = lazy(() => import('@/components/config/BridgeVlanPanel').then(m => ({ default: m.BridgeVlanPanel })))
const SnmpPanel = lazy(() => import('@/components/config/SnmpPanel').then(m => ({ default: m.SnmpPanel })))
const ClientsTab = lazy(() => import('@/components/network/ClientsTab').then(m => ({ default: m.ClientsTab })))
const VpnTab = lazy(() => import('@/components/network/VpnTab').then(m => ({ default: m.VpnTab })))
const LogsTab = lazy(() => import('@/components/network/LogsTab').then(m => ({ default: m.LogsTab })))
const WirelessStationTable = lazy(() => import('@/components/wireless/WirelessStationTable').then(m => ({ default: m.WirelessStationTable })))
const RFStatsCard = lazy(() => import('@/components/wireless/RFStatsCard').then(m => ({ default: m.RFStatsCard })))

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
      <Suspense fallback={<p role="status">Loading panel…</p>}>
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
      </Suspense>
    )
  }

  // -------------------------------------------------------------------------
  // Simple Mode — vertical sidebar + category panels
  // -------------------------------------------------------------------------
  return (
    <Suspense fallback={<p role="status">Loading panel…</p>}>
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
    </Suspense>
  )
}
