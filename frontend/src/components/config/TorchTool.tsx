/**
 * TorchTool -- Live traffic monitoring per interface.
 *
 * Uses /tool/torch via config editor execute.
 * Filter by src/dst address, protocol, port.
 * Auto-refresh with configurable interval.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Play, Square, Flame, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { configEditorApi } from '@/lib/configEditorApi'
import { useConfigBrowse } from '@/hooks/useConfigPanel'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

interface TorchEntry {
  srcAddress: string
  dstAddress: string
  protocol: string
  srcPort: string
  dstPort: string
  txRate: string
  rxRate: string
  tx: string
  rx: string
}

function formatBps(val: string): string {
  const n = parseInt(val, 10)
  if (isNaN(n)) return val || '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mbps`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} Kbps`
  return `${n} bps`
}

export function TorchTool({ tenantId, deviceId, active }: ConfigPanelProps) {
  const interfaces = useConfigBrowse(tenantId, deviceId, '/interface', { enabled: active })
  const [iface, setIface] = useState('ether1')
  const [srcFilter, setSrcFilter] = useState('')
  const [dstFilter, setDstFilter] = useState('')
  const [protocolFilter, setProtocolFilter] = useState('')
  const [portFilter, setPortFilter] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [entries, setEntries] = useState<TorchEntry[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const torchMutation = useMutation({
    mutationFn: async () => {
      const parts = ['/tool/torch', `interface=${iface}`, 'duration=3s']
      if (srcFilter) parts.push(`src-address=${srcFilter}`)
      if (dstFilter) parts.push(`dst-address=${dstFilter}`)
      if (protocolFilter) parts.push(`protocol=${protocolFilter}`)
      if (portFilter) parts.push(`port=${portFilter}`)
      return configEditorApi.execute(tenantId, deviceId, parts.join(' '))
    },
    onSuccess: (resp) => {
      if (!resp.success) { setEntries([]); return }
      const rows: TorchEntry[] = resp.data
        .filter((d) => d['src-address'] || d['dst-address'])
        .map((d) => ({
          srcAddress: d['src-address'] || '',
          dstAddress: d['dst-address'] || '',
          protocol: d['ip-protocol'] || d['protocol'] || '',
          srcPort: d['src-port'] || '',
          dstPort: d['dst-port'] || '',
          txRate: d['tx-rate'] || d['tx'] || '',
          rxRate: d['rx-rate'] || d['rx'] || '',
          tx: d['tx-packets'] || '',
          rx: d['rx-packets'] || '',
        }))
      setEntries(rows)
    },
  })

  const handleRun = useCallback(() => {
    torchMutation.mutate()
  }, [torchMutation])

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && !torchMutation.isPending) {
      timerRef.current = setInterval(() => {
        torchMutation.mutate()
      }, 5000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefresh, torchMutation.isPending])

  const handleToggleAuto = useCallback(() => {
    if (autoRefresh) {
      setAutoRefresh(false)
      if (timerRef.current) clearInterval(timerRef.current)
    } else {
      setAutoRefresh(true)
      handleRun()
    }
  }, [autoRefresh, handleRun])

  const ifaceNames = interfaces.entries.map((e) => e['name']).filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Interface</Label>
            <select
              value={iface}
              onChange={(e) => setIface(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary font-mono"
            >
              {ifaceNames.length > 0
                ? ifaceNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))
                : <option value={iface}>{iface}</option>
              }
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Src Address</Label>
            <Input
              value={srcFilter}
              onChange={(e) => setSrcFilter(e.target.value)}
              placeholder="any"
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Dst Address</Label>
            <Input
              value={dstFilter}
              onChange={(e) => setDstFilter(e.target.value)}
              placeholder="any"
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Protocol</Label>
            <Input
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value)}
              placeholder="any"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Port</Label>
            <Input
              value={portFilter}
              onChange={(e) => setPortFilter(e.target.value)}
              placeholder="any"
              className="h-8 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            onClick={handleRun}
            disabled={torchMutation.isPending}
            className="gap-1.5"
          >
            {torchMutation.isPending ? (
              <><Square className="h-3.5 w-3.5" /> Capturing...</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> Capture</>
            )}
          </Button>
          <Button
            variant={autoRefresh ? 'destructive' : 'outline'}
            onClick={handleToggleAuto}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', autoRefresh && 'animate-spin')} />
            {autoRefresh ? 'Stop Auto' : 'Auto Refresh'}
          </Button>
        </div>
      </div>

      {torchMutation.isError && (
        <div className="rounded-lg border border-error/50 bg-error/10 p-4 text-sm text-error">
          Failed to execute torch command.
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2">
            <Flame className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-secondary">
              Torch — {iface} ({entries.length} flows)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-text-muted">
                  <th className="text-left px-3 py-2">Src Address</th>
                  <th className="text-left px-3 py-2">Dst Address</th>
                  <th className="text-left px-3 py-2">Proto</th>
                  <th className="text-left px-3 py-2">Src Port</th>
                  <th className="text-left px-3 py-2">Dst Port</th>
                  <th className="text-right px-3 py-2">TX Rate</th>
                  <th className="text-right px-3 py-2">RX Rate</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {entries.map((e, i) => (
                  <tr key={i} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 text-text-primary">{e.srcAddress || '-'}</td>
                    <td className="px-3 py-1.5 text-text-primary">{e.dstAddress || '-'}</td>
                    <td className="px-3 py-1.5 text-text-secondary">{e.protocol || '-'}</td>
                    <td className="px-3 py-1.5 text-text-muted">{e.srcPort || '-'}</td>
                    <td className="px-3 py-1.5 text-text-muted">{e.dstPort || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-accent">{formatBps(e.txRate)}</td>
                    <td className="px-3 py-1.5 text-right text-info">{formatBps(e.rxRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entries.length === 0 && !torchMutation.isPending && !torchMutation.isIdle && (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          No traffic captured. Try a different interface or remove filters.
        </div>
      )}
    </div>
  )
}
