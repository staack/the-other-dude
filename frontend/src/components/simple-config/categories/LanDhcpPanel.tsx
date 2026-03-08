/**
 * LanDhcpPanel -- Simple mode LAN address and DHCP server configuration.
 *
 * Shows LAN address, DHCP server settings, pool range, and active leases.
 */

import { useState, useEffect } from 'react'
import { Network, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { SimpleFormField } from '../SimpleFormField'
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

export function LanDhcpPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const addresses = useConfigBrowse(tenantId, deviceId, '/ip/address', { enabled: active })
  const dhcpServer = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-server', { enabled: active })
  const dhcpNetwork = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-server/network', { enabled: active })
  const pools = useConfigBrowse(tenantId, deviceId, '/ip/pool', { enabled: active })
  const leases = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-server/lease', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-lan')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Find the bridge/LAN address
  const lanEntry = addresses.entries.find(
    (e) => e.interface?.includes('bridge') || e.interface?.includes('lan'),
  ) ?? addresses.entries[0]

  const serverEntry = dhcpServer.entries[0]
  const networkEntry = dhcpNetwork.entries[0]
  const poolEntry = pools.entries[0]

  // LAN form state
  const [lanAddress, setLanAddress] = useState('')
  const [poolRange, setPoolRange] = useState('')
  const [dhcpGateway, setDhcpGateway] = useState('')
  const [dhcpDns, setDhcpDns] = useState('')
  const [leaseTime, setLeaseTime] = useState('')

  // Sync from browse data
  useEffect(() => {
    if (lanEntry) setLanAddress(lanEntry.address ?? '')
  }, [lanEntry])

  useEffect(() => {
    if (poolEntry) setPoolRange(poolEntry.ranges ?? '')
  }, [poolEntry])

  useEffect(() => {
    if (networkEntry) {
      setDhcpGateway(networkEntry.gateway ?? '')
      setDhcpDns(networkEntry['dns-server'] ?? '')
      setLeaseTime(networkEntry['lease-time'] ?? '')
    }
  }, [networkEntry])

  const isLoading = addresses.isLoading || dhcpServer.isLoading

  const stageChanges = () => {
    // LAN address
    if (lanEntry && lanAddress !== lanEntry.address) {
      panel.addChange({
        operation: 'set',
        path: '/ip/address',
        entryId: lanEntry['.id'],
        properties: { address: lanAddress },
        description: `Update LAN address to ${lanAddress}`,
      })
    }

    // Pool range
    if (poolEntry && poolRange !== poolEntry.ranges) {
      panel.addChange({
        operation: 'set',
        path: '/ip/pool',
        entryId: poolEntry['.id'],
        properties: { ranges: poolRange },
        description: `Update DHCP pool range to ${poolRange}`,
      })
    }

    // DHCP network settings
    if (networkEntry) {
      const props: Record<string, string> = {}
      if (dhcpGateway !== networkEntry.gateway) props.gateway = dhcpGateway
      if (dhcpDns !== networkEntry['dns-server']) props['dns-server'] = dhcpDns
      if (leaseTime !== networkEntry['lease-time']) props['lease-time'] = leaseTime
      if (Object.keys(props).length > 0) {
        panel.addChange({
          operation: 'set',
          path: '/ip/dhcp-server/network',
          entryId: networkEntry['.id'],
          properties: props,
          description: 'Update DHCP network settings',
        })
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading LAN configuration...
      </div>
    )
  }

  const activeLeases = leases.entries.filter((l) => l.status === 'bound' || l.status === 'waiting')

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'LAN IP', value: lanEntry?.address ?? 'Not configured' },
          { label: 'DHCP Server', value: serverEntry?.disabled === 'true' ? 'Disabled' : serverEntry ? 'Enabled' : 'Not configured' },
          { label: 'Pool', value: poolEntry?.ranges ?? '\u2014' },
          { label: 'Active Leases', value: String(activeLeases.length) },
        ]}
        isLoading={isLoading}
      />

      <SimpleFormSection icon={Network} title="LAN Address" description="The IP address of this router on the local network">
        <SimpleFormField
          field={{ key: 'address', label: 'IP Address / Mask', type: 'cidr', required: true, placeholder: '192.168.88.1/24' }}
          value={lanAddress}
          onChange={setLanAddress}
        />
        {lanEntry?.interface && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Interface:</span>
            <span className="font-mono text-text-secondary">{lanEntry.interface}</span>
          </div>
        )}
      </SimpleFormSection>

      <SimpleFormSection icon={Server} title="DHCP Server" description="Automatically assign IP addresses to network clients">
        <SimpleFormField
          field={{ key: 'ranges', label: 'Address Pool', type: 'text', placeholder: '192.168.88.10-192.168.88.254', help: 'Range of IP addresses for DHCP clients' }}
          value={poolRange}
          onChange={setPoolRange}
        />
        <SimpleFormField
          field={{ key: 'gateway', label: 'Gateway', type: 'ip', placeholder: '192.168.88.1' }}
          value={dhcpGateway}
          onChange={setDhcpGateway}
        />
        <SimpleFormField
          field={{ key: 'dns-server', label: 'DNS Servers', type: 'text', placeholder: '192.168.88.1', help: 'DNS servers provided to DHCP clients' }}
          value={dhcpDns}
          onChange={setDhcpDns}
        />
        <SimpleFormField
          field={{ key: 'lease-time', label: 'Lease Time', type: 'text', placeholder: '10m', help: 'How long a DHCP lease is valid (e.g., 10m, 1h, 1d)' }}
          value={leaseTime}
          onChange={setLeaseTime}
        />
        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={stageChanges}>
            Stage Changes
          </Button>
        </div>
      </SimpleFormSection>

      {/* Active Leases (read-only) */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-secondary">
          Active Leases ({activeLeases.length})
        </h3>
        {activeLeases.length === 0 ? (
          <p className="text-xs text-text-muted">No active DHCP leases</p>
        ) : (
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-elevated/30">
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Hostname</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">IP</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">MAC</th>
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Expires</th>
                </tr>
              </thead>
              <tbody>
                {activeLeases.map((lease) => (
                  <tr key={lease['.id']} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-1.5 text-text-primary">{lease['host-name'] || '\u2014'}</td>
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{lease.address}</td>
                    <td className="px-3 py-1.5 font-mono text-text-muted">{lease['mac-address']}</td>
                    <td className="px-3 py-1.5 text-text-muted">{lease['expires-after'] || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SimpleApplyBar
        pendingCount={panel.pendingChanges.length}
        isApplying={panel.isApplying}
        onReviewClick={() => setPreviewOpen(true)}
      />

      <ChangePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        changes={panel.pendingChanges}
        applyMode={panel.applyMode}
        onConfirm={() => { panel.applyChanges(); setPreviewOpen(false) }}
        isApplying={panel.isApplying}
      />
    </div>
  )
}
