import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Search, AlertCircle } from 'lucide-react'
import { devicesApi, type SubnetScanResponse } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  tenantId: string
  onResults: (results: SubnetScanResponse) => void
}

export function SubnetScanForm({ tenantId, onResults }: Props) {
  const [cidr, setCidr] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => devicesApi.scan(tenantId, cidr),
    onSuccess: (data) => {
      onResults(data)
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Scan failed. Check the CIDR format.'
      setError(detail)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!cidr.trim()) {
      setError('CIDR is required (e.g. 192.168.1.0/24)')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Scan Subnet</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Discover MikroTik devices on a network range (max /20 — 4096 IPs)
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1 max-w-xs space-y-1.5">
          <Label htmlFor="scan-cidr">Network CIDR</Label>
          <Input
            id="scan-cidr"
            value={cidr}
            onChange={(e) => {
              setCidr(e.target.value)
              if (error) setError(null)
            }}
            placeholder="e.g., 192.168.1.0/24"
            autoFocus
          />
          <p className="text-[10px] text-text-muted mt-0.5">CIDR notation — /24 scans 254 addresses</p>
        </div>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <Search className="h-3.5 w-3.5 animate-pulse" />
              Scanning...
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              Scan
            </>
          )}
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-error/10 border border-error/50 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-error flex-shrink-0" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      {mutation.isPending && (
        <div className="text-xs text-text-muted animate-pulse">
          Scanning {cidr}... This may take up to 30 seconds for larger ranges.
        </div>
      )}
    </div>
  )
}
