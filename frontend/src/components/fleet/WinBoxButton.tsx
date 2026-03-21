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
        onError: (err: unknown) => {
            const e = err as { response?: { data?: { detail?: string } } }
            setState('error')
            setError(e.response?.data?.detail || 'Failed to open tunnel')
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
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-control)] text-[10px] text-text-secondary border border-border-default hover:border-accent transition-[border-color,color] duration-[50ms] disabled:opacity-50"
                    title="Open WinBox tunnel"
                >
                    {openMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Monitor className="h-3 w-3" />
                    )}
                    {openMutation.isPending ? 'Connecting' : 'WinBox'}
                </button>
                {error && <p className="mt-2 text-sm text-error">{error}</p>}
            </div>
        )
    }

    if (state === 'ready' && tunnelInfo) {
        return (
            <div className="rounded-sm border border-border-default bg-panel p-2.5 space-y-2">
                <p className="text-xs text-text-primary">
                    Tunnel ready: <code className="font-mono text-[10px] text-text-secondary">{tunnelInfo.host}:{tunnelInfo.port}</code>
                </p>
                <div className="flex gap-1">
                    <button
                        onClick={copyAddress}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-[var(--radius-control)] border border-border-default text-text-secondary hover:border-accent transition-[border-color] duration-[50ms]"
                    >
                        <Copy className="h-2.5 w-2.5" />
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                        onClick={() => {
                            setState('closing')
                            closeMutation.mutate()
                        }}
                        disabled={closeMutation.isPending}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-[var(--radius-control)] border border-border-default text-text-muted hover:border-accent disabled:opacity-50 transition-[border-color] duration-[50ms]"
                    >
                        <X className="h-2.5 w-2.5" />
                        Close
                    </button>
                </div>
                <p className="text-[9px] text-text-muted">Closes after 5 min idle</p>
            </div>
        )
    }

    return null
}
