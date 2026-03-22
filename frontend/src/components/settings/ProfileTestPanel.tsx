import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'
import {
  snmpProfilesApi,
  type ProfileTestRequest,
  type ProfileTestResponse,
} from '@/lib/api'
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProfileTestPanelProps {
  tenantId: string
  profileId: string | null
}

type SNMPVersion = 'v1' | 'v2c' | 'v3'
type SecurityLevel = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv'

const SECURITY_LEVELS: { value: SecurityLevel; label: string }[] = [
  { value: 'noAuthNoPriv', label: 'No Auth, No Privacy' },
  { value: 'authNoPriv', label: 'Auth, No Privacy' },
  { value: 'authPriv', label: 'Auth + Privacy' },
]

const AUTH_PROTOCOLS = ['MD5', 'SHA', 'SHA256'] as const
const PRIV_PROTOCOLS = ['DES', 'AES', 'AES256'] as const

// ─── Component ──────────────────────────────────────────────────────────────

export function ProfileTestPanel({ tenantId, profileId }: ProfileTestPanelProps) {
  const [expanded, setExpanded] = useState(false)

  // ─── Form state ──────────────────────────────────────────────────────

  const [ipAddress, setIpAddress] = useState('')
  const [snmpPort, setSnmpPort] = useState('161')
  const [snmpVersion, setSnmpVersion] = useState<SNMPVersion>('v2c')
  const [community, setCommunity] = useState('public')
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>('authNoPriv')
  const [username, setUsername] = useState('')
  const [authProtocol, setAuthProtocol] = useState('SHA')
  const [authPassphrase, setAuthPassphrase] = useState('')
  const [privProtocol, setPrivProtocol] = useState('AES')
  const [privPassphrase, setPrivPassphrase] = useState('')

  // ─── Test mutation ───────────────────────────────────────────────────

  const testMutation = useMutation({
    mutationFn: (data: ProfileTestRequest) =>
      snmpProfilesApi.testProfile(tenantId, profileId!, data),
  })

  function handleTest() {
    if (!profileId || !ipAddress.trim()) return

    const request: ProfileTestRequest = {
      ip_address: ipAddress.trim(),
      snmp_version: snmpVersion,
    }

    const port = parseInt(snmpPort, 10)
    if (!isNaN(port) && port !== 161) request.snmp_port = port

    if (snmpVersion === 'v1' || snmpVersion === 'v2c') {
      if (community.trim()) request.community = community.trim()
    } else {
      request.security_level = securityLevel
      if (username.trim()) request.username = username.trim()
      if (securityLevel === 'authNoPriv' || securityLevel === 'authPriv') {
        request.auth_protocol = authProtocol
        if (authPassphrase) request.auth_passphrase = authPassphrase
      }
      if (securityLevel === 'authPriv') {
        request.priv_protocol = privProtocol
        if (privPassphrase) request.priv_passphrase = privPassphrase
      }
    }

    testMutation.mutate(request)
  }

  const result = testMutation.data as ProfileTestResponse | undefined

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="rounded-sm border border-border bg-panel">
      {/* Header */}
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-surface-hover"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          className={`h-4 w-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <h2 className="text-sm font-medium text-text-secondary">Test Against Device</h2>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {/* Connection fields */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">IP Address</Label>
              <Input
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                placeholder="192.168.1.1"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">SNMP Port</Label>
              <Input
                value={snmpPort}
                onChange={(e) => setSnmpPort(e.target.value)}
                placeholder="161"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">SNMP Version</Label>
            <Select value={snmpVersion} onValueChange={(v) => setSnmpVersion(v as SNMPVersion)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="v1">v1</SelectItem>
                <SelectItem value="v2c">v2c</SelectItem>
                <SelectItem value="v3">v3</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* v1/v2c: community string */}
          {(snmpVersion === 'v1' || snmpVersion === 'v2c') && (
            <div>
              <Label className="text-xs">Community String</Label>
              <Input
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                placeholder="public"
                className="mt-1"
              />
            </div>
          )}

          {/* v3 fields */}
          {snmpVersion === 'v3' && (
            <>
              <div>
                <Label className="text-xs">Security Level</Label>
                <Select
                  value={securityLevel}
                  onValueChange={(v) => setSecurityLevel(v as SecurityLevel)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECURITY_LEVELS.map((sl) => (
                      <SelectItem key={sl.value} value={sl.value}>
                        {sl.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Username</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="snmpuser"
                  className="mt-1"
                />
              </div>

              {/* Auth fields */}
              {(securityLevel === 'authNoPriv' || securityLevel === 'authPriv') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Auth Protocol</Label>
                    <Select value={authProtocol} onValueChange={setAuthProtocol}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTH_PROTOCOLS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Auth Passphrase</Label>
                    <Input
                      type="password"
                      value={authPassphrase}
                      onChange={(e) => setAuthPassphrase(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}

              {/* Privacy fields */}
              {securityLevel === 'authPriv' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Privacy Protocol</Label>
                    <Select value={privProtocol} onValueChange={setPrivProtocol}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIV_PROTOCOLS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Privacy Passphrase</Label>
                    <Input
                      type="password"
                      value={privPassphrase}
                      onChange={(e) => setPrivPassphrase(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Test button */}
          <div>
            <Button
              size="sm"
              onClick={handleTest}
              disabled={!profileId || !ipAddress.trim() || testMutation.isPending}
              title={!profileId ? 'Save the profile first to test it' : undefined}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {testMutation.isPending ? 'Testing...' : 'Test Connection'}
            </Button>
            {!profileId && (
              <p className="text-[10px] text-text-muted mt-1">
                Save the profile first to test it
              </p>
            )}
          </div>

          {/* Results */}
          {result && (
            <div
              className={`rounded-sm border px-3 py-2 ${result.success ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {result.success ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium text-success">Device reachable</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-error" />
                    <span className="text-sm font-medium text-error">Device unreachable</span>
                  </>
                )}
              </div>
              {result.success && result.device_info && (
                <div className="space-y-0.5 mt-2">
                  {result.device_info.sys_name && (
                    <InfoRow label="sysName" value={result.device_info.sys_name} />
                  )}
                  {result.device_info.sys_descr && (
                    <InfoRow label="sysDescr" value={result.device_info.sys_descr} />
                  )}
                  {result.device_info.sys_object_id && (
                    <InfoRow label="sysObjectID" value={result.device_info.sys_object_id} />
                  )}
                </div>
              )}
              {!result.success && result.error && (
                <p className="text-xs text-text-muted mt-1">{result.error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-text-muted w-20 flex-shrink-0">{label}</span>
      <span className="text-text-primary font-mono break-all">{value}</span>
    </div>
  )
}
