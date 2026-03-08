/**
 * InternetSetupPanel -- Simple mode Internet/WAN configuration.
 *
 * Detects current WAN type (DHCP/PPPoE/Static) from live device data
 * and provides appropriate form fields for editing the connection.
 */

import { useState, useEffect } from 'react'
import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { SimpleFormField } from '../SimpleFormField'
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'
import { cn } from '@/lib/utils'

type WanType = 'dhcp' | 'pppoe' | 'static'

const WAN_OPTIONS: { value: WanType; label: string }[] = [
  { value: 'dhcp', label: 'DHCP' },
  { value: 'pppoe', label: 'PPPoE' },
  { value: 'static', label: 'Static IP' },
]

export function InternetSetupPanel({ tenantId, deviceId, active }: ConfigPanelProps) {
  const dhcpClient = useConfigBrowse(tenantId, deviceId, '/ip/dhcp-client', { enabled: active })
  const pppoeClient = useConfigBrowse(tenantId, deviceId, '/interface/pppoe-client', { enabled: active })
  const interfaces = useConfigBrowse(tenantId, deviceId, '/interface', { enabled: active })
  const routes = useConfigBrowse(tenantId, deviceId, '/ip/route', { enabled: active })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-internet')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Detect WAN type
  const detectedWanType: WanType =
    pppoeClient.entries.length > 0 ? 'pppoe' :
    dhcpClient.entries.length > 0 ? 'dhcp' : 'static'

  const [wanType, setWanType] = useState<WanType>(detectedWanType)

  // DHCP form state
  const dhcpEntry = dhcpClient.entries[0]
  const [dhcpForm, setDhcpForm] = useState({
    interface: '',
    'use-peer-dns': 'true',
    'use-peer-ntp': 'true',
    'add-default-route': 'true',
  })

  // PPPoE form state
  const pppoeEntry = pppoeClient.entries[0]
  const [pppoeForm, setPppoeForm] = useState({
    interface: '',
    user: '',
    password: '',
    'service-name': '',
    'use-peer-dns': 'true',
  })

  // Static form state
  const [staticForm, setStaticForm] = useState({
    address: '',
    interface: '',
    gateway: '',
    'dns-servers': '',
  })

  // Sync form state from browse data
  useEffect(() => {
    if (dhcpEntry) {
      setDhcpForm({
        interface: dhcpEntry.interface ?? '',
        'use-peer-dns': dhcpEntry['use-peer-dns'] ?? 'true',
        'use-peer-ntp': dhcpEntry['use-peer-ntp'] ?? 'true',
        'add-default-route': dhcpEntry['add-default-route'] ?? 'true',
      })
    }
  }, [dhcpEntry])

  useEffect(() => {
    if (pppoeEntry) {
      setPppoeForm({
        interface: pppoeEntry.interface ?? '',
        user: pppoeEntry.user ?? '',
        password: '',
        'service-name': pppoeEntry['service-name'] ?? '',
        'use-peer-dns': pppoeEntry['use-peer-dns'] ?? 'true',
      })
    }
  }, [pppoeEntry])

  useEffect(() => {
    setWanType(detectedWanType)
  }, [detectedWanType])

  // Interface options for selects
  const interfaceOptions = interfaces.entries
    .filter((e) => e.type !== 'bridge' && e.type !== 'loopback')
    .map((e) => ({ value: e.name ?? '', label: `${e.name} (${e.type ?? 'unknown'})` }))

  // Default route for status display
  const defaultRoute = routes.entries.find((r) => r['dst-address'] === '0.0.0.0/0')

  const isLoading = dhcpClient.isLoading || pppoeClient.isLoading || interfaces.isLoading

  // Stage changes
  const stageChanges = () => {
    if (wanType === 'dhcp') {
      const props: Record<string, string> = { ...dhcpForm }
      if (dhcpEntry) {
        panel.addChange({
          operation: 'set',
          path: '/ip/dhcp-client',
          entryId: dhcpEntry['.id'],
          properties: props,
          description: `Update DHCP client on ${dhcpForm.interface}`,
        })
      } else {
        panel.addChange({
          operation: 'add',
          path: '/ip/dhcp-client',
          properties: props,
          description: `Add DHCP client on ${dhcpForm.interface}`,
        })
      }
    } else if (wanType === 'pppoe') {
      const props: Record<string, string> = {}
      if (pppoeForm.user) props.user = pppoeForm.user
      if (pppoeForm.password) props.password = pppoeForm.password
      if (pppoeForm.interface) props.interface = pppoeForm.interface
      if (pppoeForm['service-name']) props['service-name'] = pppoeForm['service-name']
      props['use-peer-dns'] = pppoeForm['use-peer-dns']

      if (pppoeEntry) {
        panel.addChange({
          operation: 'set',
          path: '/interface/pppoe-client',
          entryId: pppoeEntry['.id'],
          properties: props,
          description: `Update PPPoE client settings`,
        })
      } else {
        props.name = 'pppoe-out1'
        panel.addChange({
          operation: 'add',
          path: '/interface/pppoe-client',
          properties: props,
          description: `Add PPPoE client on ${pppoeForm.interface}`,
        })
      }
    } else {
      // Static IP
      if (staticForm.address && staticForm.interface) {
        panel.addChange({
          operation: 'add',
          path: '/ip/address',
          properties: {
            address: staticForm.address,
            interface: staticForm.interface,
          },
          description: `Set static WAN IP ${staticForm.address} on ${staticForm.interface}`,
        })
      }
      if (staticForm.gateway) {
        panel.addChange({
          operation: 'add',
          path: '/ip/route',
          properties: {
            'dst-address': '0.0.0.0/0',
            gateway: staticForm.gateway,
          },
          description: `Set default gateway to ${staticForm.gateway}`,
        })
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading Internet configuration...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'Connection', value: wanType.toUpperCase() },
          { label: 'WAN IP', value: dhcpEntry?.address ?? pppoeEntry?.['local-address'] ?? 'Not configured' },
          { label: 'Gateway', value: defaultRoute?.gateway ?? '\u2014' },
        ]}
        isLoading={isLoading}
      />

      <SimpleFormSection icon={Globe} title="Connection Type" description="How this router connects to the internet">
        {/* WAN type selector */}
        <div className="flex gap-2">
          {WAN_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant="outline"
              size="sm"
              onClick={() => setWanType(opt.value)}
              className={cn(
                'flex-1',
                wanType === opt.value && 'bg-accent/20 text-accent border-accent/40',
              )}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* DHCP fields */}
        {wanType === 'dhcp' && (
          <div className="space-y-3 pt-2">
            <SimpleFormField
              field={{ key: 'interface', label: 'WAN Interface', type: 'select', required: true, options: interfaceOptions }}
              value={dhcpForm.interface}
              onChange={(v) => setDhcpForm((f) => ({ ...f, interface: v }))}
            />
            <SimpleFormField
              field={{ key: 'use-peer-dns', label: 'Use ISP DNS', type: 'boolean', help: 'Accept DNS servers from your ISP' }}
              value={dhcpForm['use-peer-dns']}
              onChange={(v) => setDhcpForm((f) => ({ ...f, 'use-peer-dns': v }))}
            />
            <SimpleFormField
              field={{ key: 'use-peer-ntp', label: 'Use ISP NTP', type: 'boolean', help: 'Accept time servers from your ISP' }}
              value={dhcpForm['use-peer-ntp']}
              onChange={(v) => setDhcpForm((f) => ({ ...f, 'use-peer-ntp': v }))}
            />
            <SimpleFormField
              field={{ key: 'add-default-route', label: 'Add Default Route', type: 'boolean', help: 'Automatically create a default route via this connection' }}
              value={dhcpForm['add-default-route']}
              onChange={(v) => setDhcpForm((f) => ({ ...f, 'add-default-route': v }))}
            />
          </div>
        )}

        {/* PPPoE fields */}
        {wanType === 'pppoe' && (
          <div className="space-y-3 pt-2">
            <SimpleFormField
              field={{ key: 'interface', label: 'Interface', type: 'select', required: true, options: interfaceOptions }}
              value={pppoeForm.interface}
              onChange={(v) => setPppoeForm((f) => ({ ...f, interface: v }))}
            />
            <SimpleFormField
              field={{ key: 'user', label: 'PPPoE Username', type: 'text', required: true, placeholder: 'ISP username' }}
              value={pppoeForm.user}
              onChange={(v) => setPppoeForm((f) => ({ ...f, user: v }))}
            />
            <SimpleFormField
              field={{ key: 'password', label: 'PPPoE Password', type: 'password', required: true }}
              value={pppoeForm.password}
              onChange={(v) => setPppoeForm((f) => ({ ...f, password: v }))}
            />
            <SimpleFormField
              field={{ key: 'service-name', label: 'Service Name', type: 'text', placeholder: 'Optional' }}
              value={pppoeForm['service-name']}
              onChange={(v) => setPppoeForm((f) => ({ ...f, 'service-name': v }))}
            />
            <SimpleFormField
              field={{ key: 'use-peer-dns', label: 'Use ISP DNS', type: 'boolean' }}
              value={pppoeForm['use-peer-dns']}
              onChange={(v) => setPppoeForm((f) => ({ ...f, 'use-peer-dns': v }))}
            />
          </div>
        )}

        {/* Static IP fields */}
        {wanType === 'static' && (
          <div className="space-y-3 pt-2">
            <SimpleFormField
              field={{ key: 'interface', label: 'WAN Interface', type: 'select', required: true, options: interfaceOptions }}
              value={staticForm.interface}
              onChange={(v) => setStaticForm((f) => ({ ...f, interface: v }))}
            />
            <SimpleFormField
              field={{ key: 'address', label: 'IP Address / Mask', type: 'cidr', required: true, placeholder: '192.168.1.100/24' }}
              value={staticForm.address}
              onChange={(v) => setStaticForm((f) => ({ ...f, address: v }))}
            />
            <SimpleFormField
              field={{ key: 'gateway', label: 'Gateway', type: 'ip', required: true, placeholder: '192.168.1.1' }}
              value={staticForm.gateway}
              onChange={(v) => setStaticForm((f) => ({ ...f, gateway: v }))}
            />
            <SimpleFormField
              field={{ key: 'dns-servers', label: 'DNS Servers', type: 'text', placeholder: '8.8.8.8,8.8.4.4' }}
              value={staticForm['dns-servers']}
              onChange={(v) => setStaticForm((f) => ({ ...f, 'dns-servers': v }))}
            />
          </div>
        )}

        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={stageChanges}>
            Stage Changes
          </Button>
        </div>
      </SimpleFormSection>

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
