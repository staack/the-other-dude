/**
 * TracerouteTool -- Traceroute from device to target.
 *
 * Uses /tool/traceroute command via config editor execute.
 * Displays hop-by-hop results with IP, hostname, RTT.
 * Configurable timeout, protocol, max-hops.
 */

import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Play, Square, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { configEditorApi } from '@/lib/configEditorApi'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

interface HopResult {
  hop: string
  address: string
  hostname: string
  rtt1: string
  rtt2: string
  rtt3: string
  loss: string
  status: string
}

export function TracerouteTool({ tenantId, deviceId }: ConfigPanelProps) {
  const [target, setTarget] = useState('8.8.8.8')
  const [maxHops, setMaxHops] = useState('30')
  const [timeout, setTimeout] = useState('1000')
  const [protocol, setProtocol] = useState('icmp')
  const [hops, setHops] = useState<HopResult[]>([])

  const traceMutation = useMutation({
    mutationFn: async () => {
      const parts = ['/tool/traceroute', `address=${target}`, `count=3`]
      if (maxHops !== '30') parts.push(`max-hops=${maxHops}`)
      if (timeout !== '1000') parts.push(`timeout=${timeout}ms`)
      if (protocol !== 'icmp') parts.push(`protocol=${protocol}`)
      return configEditorApi.execute(tenantId, deviceId, parts.join(' '))
    },
    onSuccess: (resp) => {
      if (!resp.success) {
        setHops([])
        return
      }
      const rows: HopResult[] = resp.data.map((d) => ({
        hop: d['#'] || d['hop'] || '',
        address: d['address'] || d['host'] || '',
        hostname: d['hostname'] || '',
        rtt1: d['avg-rtt'] || d['last'] || d['time1'] || '',
        rtt2: d['time2'] || '',
        rtt3: d['time3'] || '',
        loss: d['loss'] || d['packet-loss'] || '',
        status: d['status'] || (d['address'] ? 'ok' : 'timeout'),
      }))
      setHops(rows)
    },
  })

  const handleRun = useCallback(() => {
    if (!target.trim()) return
    setHops([])
    traceMutation.mutate()
  }, [target, traceMutation])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs text-text-secondary">Target IP / Hostname</Label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="8.8.8.8"
              className="h-8 text-sm font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Max Hops</Label>
            <Input
              type="number"
              value={maxHops}
              onChange={(e) => setMaxHops(e.target.value)}
              min={1}
              max={64}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Timeout (ms)</Label>
            <Input
              type="number"
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
              min={100}
              max={10000}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Protocol</Label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
            >
              <option value="icmp">ICMP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Button
            onClick={handleRun}
            disabled={!target.trim() || traceMutation.isPending}
            className="gap-1.5"
          >
            {traceMutation.isPending ? (
              <><Square className="h-3.5 w-3.5" /> Running...</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> Traceroute</>
            )}
          </Button>
        </div>
      </div>

      {traceMutation.isError && (
        <div className="rounded-lg border border-error/50 bg-error/10 p-4 text-sm text-error">
          Failed to execute traceroute command.
        </div>
      )}

      {hops.length > 0 && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2">
            <Route className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-secondary">
              Traceroute to {target} ({hops.length} hops)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-text-muted">
                  <th className="text-left px-4 py-2 w-12">#</th>
                  <th className="text-left px-4 py-2">Address</th>
                  <th className="text-left px-4 py-2">Hostname</th>
                  <th className="text-right px-4 py-2">RTT</th>
                  <th className="text-right px-4 py-2">Loss</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {hops.map((hop, i) => (
                  <tr
                    key={i}
                    className={cn(
                      'border-b border-border/20 last:border-0',
                      hop.status === 'timeout' ? 'text-text-muted' : 'text-text-primary',
                    )}
                  >
                    <td className="px-4 py-1.5 text-text-muted">{hop.hop || i + 1}</td>
                    <td className="px-4 py-1.5">{hop.address || '* * *'}</td>
                    <td className="px-4 py-1.5 text-text-secondary">{hop.hostname || '-'}</td>
                    <td className="px-4 py-1.5 text-right">
                      {hop.rtt1 ? `${hop.rtt1}ms` : '*'}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {hop.loss && hop.loss !== '0' ? (
                        <span className="text-warning">{hop.loss}%</span>
                      ) : (
                        <span className="text-success">0%</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
