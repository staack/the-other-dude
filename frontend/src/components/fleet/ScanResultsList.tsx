import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Wifi, WifiOff } from 'lucide-react'
import { devicesApi, type SubnetScanResponse } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  tenantId: string
  results: SubnetScanResponse
  onDone: () => void
}

interface DeviceCredentials {
  username: string
  password: string
}

export function ScanResultsList({ tenantId, results, onDone }: Props) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sharedCreds, setSharedCreds] = useState<DeviceCredentials>({
    username: 'admin',
    password: '',
  })
  const [useShared] = useState(true)

  const mutation = useMutation({
    mutationFn: () =>
      devicesApi.bulkAdd(tenantId, {
        devices: Array.from(selected).map((ip) => {
          const discovered = results.discovered.find((d) => d.ip_address === ip)
          return {
            ip_address: ip,
            hostname: discovered?.hostname ?? undefined,
          }
        }),
        shared_username: useShared ? sharedCreds.username : undefined,
        shared_password: useShared ? sharedCreds.password : undefined,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['devices', tenantId] })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      const added = data.added.length
      const failed = data.failed.length
      toast({
        title: `${added} device${added !== 1 ? 's' : ''} added${failed > 0 ? `, ${failed} failed` : ''}`,
        variant: failed > 0 ? 'destructive' : 'default',
      })
      onDone()
    },
    onError: () => {
      toast({ title: 'Bulk add failed', variant: 'destructive' })
    },
  })

  const toggleSelect = (ip: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(results.discovered.map((d) => d.ip_address)))
  }

  const deselectAll = () => setSelected(new Set())

  const allSelected =
    results.discovered.length > 0 && selected.size === results.discovered.length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">
            Scan complete —{' '}
            <span className="text-success">{results.total_discovered} discovered</span>
            {' '}of {results.total_scanned} addresses scanned
          </p>
          <p className="text-xs text-text-muted mt-0.5">CIDR: {results.cidr}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={allSelected ? deselectAll : selectAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </Button>
        </div>
      </div>

      {results.discovered.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-8 text-center text-text-muted text-sm">
          No MikroTik devices found in this range
        </div>
      ) : (
        <>
          {/* Device checklist */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-3 py-2 w-8">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) => (c ? selectAll() : deselectAll())}
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">IP Address</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-text-muted">Hostname</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">API</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-text-muted">TLS</th>
                </tr>
              </thead>
              <tbody>
                {results.discovered.map((device) => (
                  <tr
                    key={device.ip_address}
                    className="border-b border-border/50 hover:bg-surface cursor-pointer"
                    onClick={() => toggleSelect(device.ip_address)}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(device.ip_address)}
                        onCheckedChange={() => toggleSelect(device.ip_address)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{device.ip_address}</td>
                    <td className="px-3 py-2 text-text-secondary">{device.hostname ?? '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {device.api_port_open ? (
                        <Wifi className="h-3.5 w-3.5 text-success mx-auto" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5 text-text-muted mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {device.api_ssl_port_open ? (
                        <Wifi className="h-3.5 w-3.5 text-success mx-auto" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5 text-text-muted mx-auto" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Credentials */}
          {selected.size > 0 && (
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">
                  Credentials for {selected.size} selected device{selected.size !== 1 ? 's' : ''}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-username">Username</Label>
                  <Input
                    id="bulk-username"
                    value={sharedCreds.username}
                    onChange={(e) =>
                      setSharedCreds((c) => ({ ...c, username: e.target.value }))
                    }
                    placeholder="admin"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-password">Password</Label>
                  <Input
                    id="bulk-password"
                    type="password"
                    value={sharedCreds.password}
                    onChange={(e) =>
                      setSharedCreds((c) => ({ ...c, password: e.target.value }))
                    }
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-text-muted">
                  Shared credentials used for all selected devices
                </p>
                <Button
                  size="sm"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || !sharedCreds.username || !sharedCreds.password}
                >
                  {mutation.isPending ? (
                    'Adding...'
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Add {selected.size} Device{selected.size !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>

              {mutation.isError && (
                <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
                  <XCircle className="h-4 w-4 text-error" />
                  <p className="text-xs text-error">Failed to add devices. Please try again.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
