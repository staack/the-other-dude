/**
 * WifiSimplePanel -- Simplified wireless configuration for Simple mode.
 *
 * RouterOS version-aware: uses /interface/wireless for v6, /interface/wifi for v7+.
 * Shows "no wireless hardware" for devices without WiFi.
 */

import { useState, useEffect } from 'react'
import { Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfigBrowse, useConfigPanel } from '@/hooks/useConfigPanel'
import { ChangePreviewModal } from '@/components/config/ChangePreviewModal'
import { SimpleFormField } from '../SimpleFormField'
import { SimpleFormSection } from '../SimpleFormSection'
import { SimpleStatusBanner } from '../SimpleStatusBanner'
import { SimpleApplyBar } from '../SimpleApplyBar'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

interface WifiSimplePanelProps extends ConfigPanelProps {
  routerosVersion?: string | null
}

export function WifiSimplePanel({ tenantId, deviceId, active, routerosVersion }: WifiSimplePanelProps) {
  const majorVersion = routerosVersion ? parseInt(routerosVersion.split('.')[0], 10) : 7
  const isV7 = majorVersion >= 7
  const wirelessPath = isV7 ? '/interface/wifi' : '/interface/wireless'

  const wireless = useConfigBrowse(tenantId, deviceId, wirelessPath, { enabled: active })
  const securityProfiles = useConfigBrowse(tenantId, deviceId, '/interface/wireless/security-profiles', { enabled: active && !isV7 })

  const panel = useConfigPanel(tenantId, deviceId, 'simple-wifi')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Per-interface form state keyed by .id
  const [formState, setFormState] = useState<Record<string, Record<string, string>>>({})

  // Sync form state from browse data
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const newState: Record<string, Record<string, string>> = {}
    wireless.entries.forEach((entry) => {
      const id = entry['.id']
      if (id && !formState[id]) {
        if (isV7) {
          newState[id] = {
            ssid: entry.ssid ?? entry['configuration.ssid'] ?? '',
            passphrase: '',
            band: entry['configuration.band'] ?? entry.band ?? '',
            disabled: entry.disabled ?? 'false',
          }
        } else {
          newState[id] = {
            ssid: entry.ssid ?? '',
            band: entry.band ?? '',
            'channel-width': entry['channel-width'] ?? '',
            frequency: entry.frequency ?? '',
            'security-profile': entry['security-profile'] ?? '',
            disabled: entry.disabled ?? 'false',
          }
        }
      }
    })
    if (Object.keys(newState).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormState((prev) => ({ ...prev, ...newState }))
    }
  }, [wireless.entries, isV7])

  const updateField = (id: string, key: string, value: string) => {
    setFormState((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }))
  }

  const stageInterfaceChanges = (entry: Record<string, string>) => {
    const id = entry['.id']
    const form = formState[id]
    if (!form) return

    const props: Record<string, string> = {}

    if (isV7) {
      if (form.ssid !== (entry.ssid ?? entry['configuration.ssid'] ?? '')) {
        props.ssid = form.ssid
      }
      if (form.passphrase) {
        props['security.passphrase'] = form.passphrase
      }
      if (form.band !== (entry['configuration.band'] ?? entry.band ?? '')) {
        props['configuration.band'] = form.band
      }
      if (form.disabled !== (entry.disabled ?? 'false')) {
        props.disabled = form.disabled
      }
    } else {
      if (form.ssid !== (entry.ssid ?? '')) props.ssid = form.ssid
      if (form.band !== (entry.band ?? '')) props.band = form.band
      if (form['channel-width'] !== (entry['channel-width'] ?? '')) props['channel-width'] = form['channel-width']
      if (form.frequency !== (entry.frequency ?? '')) props.frequency = form.frequency
      if (form['security-profile'] !== (entry['security-profile'] ?? '')) props['security-profile'] = form['security-profile']
      if (form.disabled !== (entry.disabled ?? 'false')) props.disabled = form.disabled
    }

    if (Object.keys(props).length > 0) {
      panel.addChange({
        operation: 'set',
        path: wirelessPath,
        entryId: id,
        properties: props,
        description: `Update wireless ${entry.name ?? id}: ${Object.keys(props).join(', ')}`,
      })
    }
  }

  const isLoading = wireless.isLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-muted">
        Loading WiFi configuration...
      </div>
    )
  }

  // No wireless hardware
  if (wireless.entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-12 text-center">
        <Wifi className="h-8 w-8 text-text-muted/50 mx-auto mb-3" />
        <p className="text-sm font-medium text-text-secondary">
          This device does not have wireless hardware
        </p>
        <p className="text-xs text-text-muted mt-1">
          WiFi settings are only available on MikroTik devices with built-in wireless or wireless cards.
        </p>
      </div>
    )
  }

  const firstEntry = wireless.entries[0]
  const ssidDisplay = isV7
    ? firstEntry.ssid ?? firstEntry['configuration.ssid'] ?? 'Unknown'
    : firstEntry.ssid ?? 'Unknown'

  const secProfileOptions = securityProfiles.entries.map((p) => ({
    value: p.name ?? '',
    label: p.name ?? '',
  }))

  return (
    <div className="space-y-6">
      <SimpleStatusBanner
        items={[
          { label: 'SSID', value: ssidDisplay },
          { label: 'Band', value: firstEntry.band ?? firstEntry['configuration.band'] ?? '\u2014' },
          { label: 'Status', value: firstEntry.disabled === 'true' ? 'Disabled' : 'Enabled' },
          ...(wireless.entries.length > 1 ? [{ label: 'Interfaces', value: `${wireless.entries.length} total` }] : []),
        ]}
        isLoading={isLoading}
      />

      {wireless.entries.map((entry) => {
        const id = entry['.id']
        const form = formState[id] ?? {}
        const name = entry.name ?? entry['default-name'] ?? id

        return (
          <SimpleFormSection key={id} icon={Wifi} title={name} description={isV7 ? 'RouterOS 7 WiFi interface' : 'Wireless interface'}>
            <SimpleFormField
              field={{ key: 'ssid', label: 'Network Name (SSID)', type: 'text', required: true, placeholder: 'MyNetwork' }}
              value={form.ssid ?? ''}
              onChange={(v) => updateField(id, 'ssid', v)}
            />

            {isV7 ? (
              <>
                <SimpleFormField
                  field={{ key: 'passphrase', label: 'Password', type: 'password', help: 'WPA2/WPA3 passphrase (min 8 characters)' }}
                  value={form.passphrase ?? ''}
                  onChange={(v) => updateField(id, 'passphrase', v)}
                />
                <SimpleFormField
                  field={{
                    key: 'band', label: 'Band', type: 'select',
                    options: [
                      { value: '2ghz-ax', label: '2.4 GHz (ax)' },
                      { value: '5ghz-ax', label: '5 GHz (ax)' },
                      { value: '2ghz-n', label: '2.4 GHz (n)' },
                      { value: '5ghz-ac', label: '5 GHz (ac)' },
                    ],
                  }}
                  value={form.band ?? ''}
                  onChange={(v) => updateField(id, 'band', v)}
                />
              </>
            ) : (
              <>
                <SimpleFormField
                  field={{
                    key: 'band', label: 'Band', type: 'select',
                    options: [
                      { value: '2ghz-b/g/n', label: '2.4 GHz (b/g/n)' },
                      { value: '5ghz-a/n/ac', label: '5 GHz (a/n/ac)' },
                    ],
                  }}
                  value={form.band ?? ''}
                  onChange={(v) => updateField(id, 'band', v)}
                />
                <SimpleFormField
                  field={{
                    key: 'channel-width', label: 'Channel Width', type: 'select',
                    options: [
                      { value: '20mhz', label: '20 MHz' },
                      { value: '20/40mhz-XX', label: '20/40 MHz' },
                      { value: '20/40/80mhz-XXXX', label: '20/40/80 MHz' },
                    ],
                  }}
                  value={form['channel-width'] ?? ''}
                  onChange={(v) => updateField(id, 'channel-width', v)}
                />
                {secProfileOptions.length > 0 && (
                  <SimpleFormField
                    field={{
                      key: 'security-profile', label: 'Security Profile', type: 'select',
                      options: secProfileOptions,
                    }}
                    value={form['security-profile'] ?? ''}
                    onChange={(v) => updateField(id, 'security-profile', v)}
                  />
                )}
              </>
            )}

            <SimpleFormField
              field={{ key: 'disabled', label: 'Enabled', type: 'boolean' }}
              value={form.disabled === 'true' ? 'false' : 'true'}
              onChange={(v) => updateField(id, 'disabled', v === 'true' ? 'false' : 'true')}
            />

            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => stageInterfaceChanges(entry)}>
                Stage Changes
              </Button>
            </div>
          </SimpleFormSection>
        )
      })}

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
