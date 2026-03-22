import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, ArrowLeft } from 'lucide-react'
import {
  credentialProfilesApi,
  snmpProfilesApi,
  devicesApi,
  type BulkAddWithProfileRequest,
  type BulkAddWithProfileResult,
  type CredentialProfileResponse,
  type SNMPProfileResponse,
} from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface BulkAddFormProps {
  tenantId: string
  deviceType: 'routeros' | 'snmp'
  onClose: () => void
  onBack?: () => void
  onSuccess?: () => void
}

/**
 * Parse a newline-separated list of IP addresses.
 * Each line is trimmed; blank lines and duplicates are removed.
 * Lines that don't look like a valid IPv4 address are skipped.
 */
function parseIPList(text: string): string[] {
  const ipv4Re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // TODO: CIDR and range expansion (e.g., 10.0.1.0/24, 10.0.1.1-10.0.1.50)
    if (line.includes('/') || line.includes('-')) continue

    if (ipv4Re.test(line) && !seen.has(line)) {
      seen.add(line)
      result.push(line)
    }
  }

  return result
}

export function BulkAddForm({
  tenantId,
  deviceType,
  onClose,
  onBack,
  onSuccess,
}: BulkAddFormProps) {
  const queryClient = useQueryClient()

  const [profileId, setProfileId] = useState('')
  const [snmpProfileId, setSnmpProfileId] = useState('')
  const [ipText, setIpText] = useState('')
  const [hostnamePrefix, setHostnamePrefix] = useState('')
  const [snmpPort, setSnmpPort] = useState('161')
  const [apiPort, setApiPort] = useState('8728')
  const [apiSslPort, setApiSslPort] = useState('8729')
  const [error, setError] = useState<string | null>(null)

  // Credential profiles filtered by device type
  const { data: profiles } = useQuery({
    queryKey: ['credential-profiles', tenantId, deviceType],
    queryFn: () => credentialProfilesApi.list(tenantId, deviceType === 'snmp' ? undefined : 'routeros'),
  })

  // SNMP device profiles (only when deviceType is snmp)
  const { data: snmpProfiles } = useQuery({
    queryKey: ['snmp-profiles', tenantId],
    queryFn: () => snmpProfilesApi.list(tenantId),
    enabled: deviceType === 'snmp',
  })

  const allProfiles: CredentialProfileResponse[] = profiles?.profiles ?? []
  const profileList = deviceType === 'snmp'
    ? allProfiles.filter((p) => p.credential_type === 'snmp_v2c' || p.credential_type === 'snmp_v3')
    : allProfiles
  const snmpProfileList: SNMPProfileResponse[] = Array.isArray(snmpProfiles)
    ? snmpProfiles
    : snmpProfiles?.profiles ?? []

  const parsedIPs = useMemo(() => parseIPList(ipText), [ipText])

  const bulkMutation = useMutation({
    mutationFn: (data: BulkAddWithProfileRequest) =>
      devicesApi.bulkAddWithProfile(tenantId, data),
    onSuccess: (result: BulkAddWithProfileResult) => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      if (result.succeeded > 0) {
        toast({
          title: `${result.succeeded} device${result.succeeded !== 1 ? 's' : ''} added`,
        })
      }
      onSuccess?.()
    },
  })

  const handleSubmit = () => {
    if (parsedIPs.length === 0) {
      setError('Enter at least one valid IP address')
      return
    }
    if (!profileId) {
      setError('Select a credential profile')
      return
    }
    setError(null)

    const devices = parsedIPs.map((ip, i) => ({
      ip_address: ip,
      hostname: hostnamePrefix
        ? `${hostnamePrefix}${String(i + 1).padStart(2, '0')}`
        : undefined,
    }))

    const request: BulkAddWithProfileRequest = {
      credential_profile_id: profileId,
      device_type: deviceType,
      defaults:
        deviceType === 'snmp'
          ? {
              snmp_port: parseInt(snmpPort) || 161,
              snmp_profile_id: snmpProfileId || undefined,
            }
          : {
              api_port: parseInt(apiPort) || 8728,
              api_ssl_port: parseInt(apiSslPort) || 8729,
            },
      devices,
    }
    bulkMutation.mutate(request)
  }

  // Show results after successful bulk add
  if (bulkMutation.isSuccess && bulkMutation.data) {
    const result = bulkMutation.data
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-secondary">
            {result.succeeded} succeeded
          </span>
          {result.failed > 0 && (
            <span className="text-error">{result.failed} failed</span>
          )}
          <span className="text-text-muted text-xs">
            of {result.total} total
          </span>
        </div>

        <div className="max-h-48 overflow-y-auto space-y-1">
          {result.results.map((r) => (
            <div
              key={r.ip_address}
              className="flex items-center gap-2 text-xs py-1 border-b border-border/50"
            >
              {r.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-error flex-shrink-0" />
              )}
              <span className="font-mono">{r.ip_address}</span>
              {r.hostname && (
                <span className="text-text-muted">{r.hostname}</span>
              )}
              {r.error && <span className="text-error ml-auto">{r.error}</span>}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to single add
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>Credential Profile *</Label>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger>
              <SelectValue placeholder="Select credential profile..." />
            </SelectTrigger>
            <SelectContent>
              {profileList.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {deviceType === 'snmp' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-snmp-port">SNMP Port</Label>
              <Input
                id="bulk-snmp-port"
                value={snmpPort}
                onChange={(e) => setSnmpPort(e.target.value)}
                placeholder="161"
                type="number"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Device Profile</Label>
              <Select value={snmpProfileId} onValueChange={setSnmpProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  {snmpProfileList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {deviceType === 'routeros' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-api-port">API Port</Label>
              <Input
                id="bulk-api-port"
                value={apiPort}
                onChange={(e) => setApiPort(e.target.value)}
                placeholder="8728"
                type="number"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-ssl-port">TLS API Port</Label>
              <Input
                id="bulk-ssl-port"
                value={apiSslPort}
                onChange={(e) => setApiSslPort(e.target.value)}
                placeholder="8729"
                type="number"
              />
            </div>
          </>
        )}

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="bulk-ips">
            IP Addresses *{' '}
            {parsedIPs.length > 0 && (
              <span className="text-text-muted font-normal">
                ({parsedIPs.length} detected)
              </span>
            )}
          </Label>
          <textarea
            id="bulk-ips"
            value={ipText}
            onChange={(e) => {
              setIpText(e.target.value)
              if (error) setError(null)
            }}
            placeholder={'Enter IPs, one per line\n10.0.1.1\n10.0.1.2\n10.0.1.3'}
            rows={6}
            className="flex w-full rounded-md border border-border bg-surface-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent font-mono resize-y"
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="bulk-prefix">Hostname Prefix</Label>
          <Input
            id="bulk-prefix"
            value={hostnamePrefix}
            onChange={(e) => setHostnamePrefix(e.target.value)}
            placeholder="tower-ap- (generates tower-ap-01, tower-ap-02, ...)"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
          <XCircle className="h-4 w-4 text-error flex-shrink-0" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      {bulkMutation.isError && (
        <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
          <XCircle className="h-4 w-4 text-error flex-shrink-0" />
          <p className="text-xs text-error">
            {(
              bulkMutation.error as {
                response?: { data?: { detail?: string } }
              }
            )?.response?.data?.detail ?? 'Bulk add failed'}
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} size="sm">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={bulkMutation.isPending || parsedIPs.length === 0}
        >
          {bulkMutation.isPending
            ? 'Adding...'
            : `Add ${parsedIPs.length} Device${parsedIPs.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}
