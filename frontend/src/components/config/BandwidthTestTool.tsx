/**
 * BandwidthTestTool -- Bandwidth test from device.
 *
 * Uses /tool/bandwidth-test via config editor execute.
 * Direction: send, receive, both. Protocol: TCP, UDP.
 * Displays throughput results.
 */

import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Play, Square, Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { configEditorApi } from '@/lib/configEditorApi'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

interface BwResult {
  direction: string
  txRate: string
  rxRate: string
  txCurrent: string
  rxCurrent: string
  lostPackets: string
  status: string
}

function formatBps(bps: string): string {
  const val = parseInt(bps, 10)
  if (isNaN(val)) return bps || '-'
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)} Gbps`
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)} Mbps`
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)} Kbps`
  return `${val} bps`
}

export function BandwidthTestTool({ tenantId, deviceId }: ConfigPanelProps) {
  const [target, setTarget] = useState('')
  const [direction, setDirection] = useState('both')
  const [protocol, setProtocol] = useState('tcp')
  const [duration, setDuration] = useState('10')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [results, setResults] = useState<BwResult[]>([])

  const bwMutation = useMutation({
    mutationFn: async () => {
      const parts = [
        '/tool/bandwidth-test',
        `address=${target}`,
        `direction=${direction}`,
        `protocol=${protocol}`,
        `duration=${duration}s`,
      ]
      if (username) parts.push(`user=${username}`)
      if (password) parts.push(`password=${password}`)
      return configEditorApi.execute(tenantId, deviceId, parts.join(' '))
    },
    onSuccess: (resp) => {
      if (!resp.success) {
        setResults([])
        return
      }
      const rows: BwResult[] = resp.data.map((d) => ({
        direction: d['direction'] || direction,
        txRate: d['tx-total-average'] || d['tx-current'] || d['tx-10-second-average'] || '',
        rxRate: d['rx-total-average'] || d['rx-current'] || d['rx-10-second-average'] || '',
        txCurrent: d['tx-current'] || '',
        rxCurrent: d['rx-current'] || '',
        lostPackets: d['lost-packets'] || '0',
        status: d['status'] || 'done',
      }))
      setResults(rows)
    },
  })

  const handleRun = useCallback(() => {
    if (!target.trim()) return
    setResults([])
    bwMutation.mutate()
  }, [target, bwMutation])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <Label className="text-xs text-text-secondary">Target Address</Label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="192.168.1.1"
              className="h-8 text-sm font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Direction</Label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
            >
              <option value="both">Both</option>
              <option value="send">Send</option>
              <option value="receive">Receive</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Protocol</Label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Duration (s)</Label>
            <Input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              min={1}
              max={60}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="optional"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="optional"
              className="h-8 text-sm"
            />
          </div>
        </div>
        <div className="mt-3">
          <Button
            onClick={handleRun}
            disabled={!target.trim() || bwMutation.isPending}
            className="gap-1.5"
          >
            {bwMutation.isPending ? (
              <><Square className="h-3.5 w-3.5" /> Testing...</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> Run Test</>
            )}
          </Button>
        </div>
      </div>

      {bwMutation.isError && (
        <div className="rounded-lg border border-error/50 bg-error/10 p-4 text-sm text-error">
          Failed to execute bandwidth test. Ensure the target device has bandwidth-test server enabled.
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-secondary">Bandwidth Test Results</span>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {results.map((r, i) => (
              <div key={i} className="space-y-3">
                {(r.txRate || r.txCurrent) && (
                  <div className="text-center">
                    <div className="text-xs text-text-muted mb-1">TX (Upload)</div>
                    <div className="text-xl font-bold text-accent">
                      {formatBps(r.txRate || r.txCurrent)}
                    </div>
                  </div>
                )}
                {(r.rxRate || r.rxCurrent) && (
                  <div className="text-center">
                    <div className="text-xs text-text-muted mb-1">RX (Download)</div>
                    <div className="text-xl font-bold text-info">
                      {formatBps(r.rxRate || r.rxCurrent)}
                    </div>
                  </div>
                )}
                {r.lostPackets && r.lostPackets !== '0' && (
                  <div className="text-center">
                    <div className="text-xs text-text-muted mb-1">Lost Packets</div>
                    <div className="text-sm font-medium text-error">{r.lostPackets}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
