import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Monitor, Copy, X, Loader2 } from 'lucide-react'
import { remoteAccessApi } from '@/lib/api'

interface WinBoxButtonProps {
    tenantId: string
    deviceId: string
}

type State = 'idle' | 'requesting' | 'ready' | 'closing' | 'error'

export function WinBoxButton({ tenantId, deviceId }: WinBoxButtonProps) {
    const [state, setState] = useState<State>('idle')
    const [tunnelInfo, setTunnelInfo] = useState<{
        tunnel_id: string
        host: string
        port: number
        winbox_uri: string
    } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const openMutation = useMutation({
        mutationFn: () => remoteAccessApi.openWinbox(tenantId, deviceId),
        onSuccess: (data) => {
            setTunnelInfo(data)
            setState('ready')

            // Attempt deep link on Windows only
            if (navigator.userAgent.includes('Windows')) {
                window.open(data.winbox_uri, '_blank')
            }
        },
        onError: (err: any) => {
            setState('error')
            setError(err.response?.data?.detail || 'Failed to open tunnel')
        },
    })

    const closeMutation = useMutation({
        mutationFn: () => {
            if (!tunnelInfo) throw new Error('No tunnel')
            return remoteAccessApi.closeWinbox(tenantId, deviceId, tunnelInfo.tunnel_id)
        },
        onSuccess: () => {
            setState('idle')
            setTunnelInfo(null)
        },
    })

    const copyAddress = async () => {
        if (!tunnelInfo) return
        const addr = `${tunnelInfo.host}:${tunnelInfo.port}`
        try {
            await navigator.clipboard.writeText(addr)
        } catch {
            // Fallback for HTTP
            const ta = document.createElement('textarea')
            ta.value = addr
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (state === 'idle' || state === 'error') {
        return (
            <div>
                <button
                    onClick={() => {
                        setState('requesting')
                        setError(null)
                        openMutation.mutate()
                    }}
                    disabled={openMutation.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    {openMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Monitor className="h-4 w-4" />
                    )}
                    {openMutation.isPending ? 'Connecting...' : 'Open WinBox'}
                </button>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </div>
        )
    }

    if (state === 'ready' && tunnelInfo) {
        return (
            <div className="rounded-md border p-4 space-y-3">
                <p className="font-medium text-sm">WinBox tunnel ready</p>
                <p className="text-sm text-muted-foreground">
                    Connect to: <code className="font-mono">{tunnelInfo.host}:{tunnelInfo.port}</code>
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={copyAddress}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    >
                        <Copy className="h-3 w-3" />
                        {copied ? 'Copied!' : 'Copy Address'}
                    </button>
                    <button
                        onClick={() => {
                            setState('closing')
                            closeMutation.mutate()
                        }}
                        disabled={closeMutation.isPending}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border hover:bg-accent disabled:opacity-50"
                    >
                        <X className="h-3 w-3" />
                        Close Tunnel
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Tunnel closes after 5 min of inactivity
                </p>
            </div>
        )
    }

    return null
}
