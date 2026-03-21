/**
 * PingTool -- Interactive ping from device to target.
 *
 * Uses /ping command via config editor execute.
 * Displays RTT min/avg/max, packet loss, TTL.
 * Configurable count, size, interface, src-address.
 */

import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Play, Square, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { configEditorApi } from '@/lib/configEditorApi'
import { cn } from '@/lib/utils'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'

interface PingResult {
  host: string
  seq: string
  ttl: string
  time: string
  status: string
}

interface PingStats {
  sent: number
  received: number
  loss: string
  minRtt: string
  avgRtt: string
  maxRtt: string
}

export function PingTool({ tenantId, deviceId }: ConfigPanelProps) {
  const [target, setTarget] = useState('8.8.8.8')
  const [count, setCount] = useState('4')
  const [size, setSize] = useState('64')
  const [srcAddress, setSrcAddress] = useState('')
  const [iface, setIface] = useState('')
  const [results, setResults] = useState<PingResult[]>([])
  const [stats, setStats] = useState<PingStats | null>(null)

  const pingMutation = useMutation({
    mutationFn: async () => {
      const parts = ['/ping', `address=${target}`, `count=${count}`]
      if (size !== '64') parts.push(`size=${size}`)
      if (srcAddress) parts.push(`src-address=${srcAddress}`)
      if (iface) parts.push(`interface=${iface}`)
      const command = parts.join(' ')
      return configEditorApi.execute(tenantId, deviceId, command)
    },
    onSuccess: (resp) => {
      if (!resp.success) {
        setResults([])
        setStats({ sent: 0, received: 0, loss: '100%', minRtt: '-', avgRtt: '-', maxRtt: '-' })
        return
      }
      const rows: PingResult[] = resp.data.map((d) => ({
        host: d['host'] || target,
        seq: d['seq'] || d['#'] || '',
        ttl: d['ttl'] || '',
        time: d['time'] || '',
        status: d['status'] || (d['time'] ? 'ok' : 'timeout'),
      }))
      setResults(rows)
      // Calculate stats
      const sent = rows.length
      const received = rows.filter((r) => r.status !== 'timeout' && r.time).length
      const rtts = rows.map((r) => parseFloat(r.time)).filter((v) => !isNaN(v))
      setStats({
        sent,
        received,
        loss: sent > 0 ? `${(((sent - received) / sent) * 100).toFixed(0)}%` : '0%',
        minRtt: rtts.length > 0 ? `${Math.min(...rtts)}ms` : '-',
        avgRtt: rtts.length > 0 ? `${(rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(1)}ms` : '-',
        maxRtt: rtts.length > 0 ? `${Math.max(...rtts)}ms` : '-',
      })
    },
  })

  const handleRun = useCallback(() => {
    if (!target.trim()) return
    setResults([])
    setStats(null)
    pingMutation.mutate()
  }, [target, pingMutation])

  return (
    <div className="space-y-4">
      {/* Input form */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            <Label className="text-xs text-text-secondary">Count</Label>
            <Input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              min={1}
              max={100}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Size (bytes)</Label>
            <Input
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              min={28}
              max={65535}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Src Address</Label>
            <Input
              value={srcAddress}
              onChange={(e) => setSrcAddress(e.target.value)}
              placeholder="optional"
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Interface</Label>
            <Input
              value={iface}
              onChange={(e) => setIface(e.target.value)}
              placeholder="optional"
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="flex items-end col-span-2 sm:col-span-2">
            <Button
              onClick={handleRun}
              disabled={!target.trim() || pingMutation.isPending}
              className="gap-1.5 w-full sm:w-auto"
            >
              {pingMutation.isPending ? (
                <><Square className="h-3.5 w-3.5" /> Running...</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> Ping</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      {pingMutation.isError && (
        <div className="rounded-lg border border-error/50 bg-error/10 p-4 text-sm text-error">
          Failed to execute ping command.
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-lg border border-border bg-panel overflow-hidden">
          <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-secondary">Ping Results</span>
          </div>
          <div className="font-mono text-xs bg-elevated p-3 space-y-0.5 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={cn(
                'flex gap-4 px-2 py-0.5 rounded',
                r.status === 'timeout' ? 'text-error' : 'text-text-primary',
              )}>
                <span className="w-8 text-text-muted text-right">{r.seq || i + 1}</span>
                <span className="w-32">{r.host}</span>
                <span className="w-16">{r.ttl ? `ttl=${r.ttl}` : ''}</span>
                <span className="w-20">{r.time ? `time=${r.time}ms` : 'timeout'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats summary */}
      {stats && (
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-center">
            <StatBox label="Sent" value={String(stats.sent)} />
            <StatBox label="Received" value={String(stats.received)} />
            <StatBox label="Loss" value={stats.loss} warn={stats.loss !== '0%'} />
            <StatBox label="Min RTT" value={stats.minRtt} />
            <StatBox label="Avg RTT" value={stats.avgRtt} />
            <StatBox label="Max RTT" value={stats.maxRtt} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className={cn('text-lg font-bold', warn ? 'text-error' : 'text-text-primary')}>
        {value}
      </div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  )
}
