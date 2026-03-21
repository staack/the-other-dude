import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Terminal as TerminalIcon, Maximize2, Minimize2, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { remoteAccessApi } from '@/lib/api'

interface SSHTerminalProps {
    tenantId: string
    deviceId: string
    deviceName: string
}

type State = 'closed' | 'connecting' | 'connected' | 'disconnected'

export function SSHTerminal({ tenantId, deviceId, deviceName }: SSHTerminalProps) {
    const [state, setState] = useState<State>('closed')
    const [expanded, setExpanded] = useState(false)
    const termRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const openMutation = useMutation({
        mutationFn: () => {
            const cols = terminalRef.current?.cols || 80
            const rows = terminalRef.current?.rows || 24
            return remoteAccessApi.openSSH(tenantId, deviceId, cols, rows)
        },
        onSuccess: (data) => {
            const { websocket_url } = data
            const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
            const url = `${scheme}://${location.host}${websocket_url}`
            connectWebSocket(url)
        },
        onError: () => {
            terminalRef.current?.write('\r\n\x1b[31mFailed to create SSH session.\x1b[0m\r\n')
            setState('disconnected')
        },
    })

    const connectWebSocket = useCallback((url: string) => {
        const ws = new WebSocket(url)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => {
            setState('connected')
            terminalRef.current?.write('Connecting to router...\r\n')
        }

        ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                terminalRef.current?.write(new Uint8Array(event.data))
            }
        }

        ws.onclose = (event) => {
            setState('disconnected')
            const reason = event.code === 1006 ? 'Connection dropped'
                : event.code === 1008 ? 'Authentication failed'
                : event.code === 1011 ? 'Server error'
                : 'Session closed'
            terminalRef.current?.write(`\r\n\x1b[31m${reason}.\x1b[0m\r\n`)
        }

        ws.onerror = () => {
            terminalRef.current?.write('\r\n\x1b[31mConnection error.\x1b[0m\r\n')
        }
    }, [])

    const initTerminal = useCallback(() => {
        if (!termRef.current || terminalRef.current) return

        const isDark = document.documentElement.classList.contains('dark')
        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 14,
            scrollback: 2000,
            convertEol: true,
            theme: isDark
                ? { background: '#09090b', foreground: '#fafafa' }
                : { background: '#ffffff', foreground: '#09090b' },
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(termRef.current)
        fitAddon.fit()

        terminalRef.current = term
        fitAddonRef.current = fitAddon

        // User input → WebSocket
        term.onData((data) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const encoder = new TextEncoder()
                wsRef.current.send(encoder.encode(data))
            }
        })

        // Resize → throttled WebSocket message
        term.onResize(({ cols, rows }) => {
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
            resizeTimerRef.current = setTimeout(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
                }
            }, 75)
        })

        // Refit on container resize
        const observer = new ResizeObserver(() => fitAddon.fit())
        observer.observe(termRef.current)

        return () => {
            observer.disconnect()
            term.dispose()
            terminalRef.current = null
        }
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            wsRef.current?.close()
            terminalRef.current?.dispose()
        }
    }, [])

    const handleOpen = () => {
        setState('connecting')
        requestAnimationFrame(() => {
            initTerminal()
            openMutation.mutate()
        })
    }

    const handleReconnect = () => {
        terminalRef.current?.dispose()
        terminalRef.current = null
        wsRef.current?.close()
        wsRef.current = null
        setState('connecting')
        requestAnimationFrame(() => {
            initTerminal()
            openMutation.mutate()
        })
    }

    const handleDisconnect = () => {
        wsRef.current?.close()
        terminalRef.current?.dispose()
        terminalRef.current = null
        setState('closed')
    }

    if (state === 'closed') {
        return (
            <button
                onClick={handleOpen}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-control)] text-[10px] text-text-secondary border border-border-default hover:border-accent transition-[border-color,color] duration-[50ms]"
                title="Open SSH Terminal"
            >
                <TerminalIcon className="h-3 w-3" />
                SSH
            </button>
        )
    }

    return (
        <div className={`rounded-sm border border-border-default overflow-hidden ${expanded ? 'fixed top-0 right-0 bottom-0 z-50 bg-background' : ''}`} style={expanded ? { left: 'var(--sidebar-width, 172px)' } : {}}>
            <div className="flex items-center justify-between px-3 py-1.5 bg-elevated border-b border-border-default">
                <span className="text-xs font-medium text-text-primary">SSH: {deviceName}</span>
                <div className="flex gap-1">
                    <button onClick={() => setExpanded(!expanded)} className="p-0.5 text-text-muted hover:text-text-secondary transition-[color] duration-[50ms]">
                        {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    </button>
                    {state === 'disconnected' ? (
                        <button onClick={handleReconnect} className="px-2 py-0.5 text-[10px] rounded-[var(--radius-control)] border border-border-default text-text-secondary hover:border-accent transition-[border-color] duration-[50ms]">
                            Reconnect
                        </button>
                    ) : (
                        <button onClick={handleDisconnect} className="p-0.5 text-text-muted hover:text-text-secondary transition-[color] duration-[50ms]">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
            <div ref={termRef} className="h-80" tabIndex={0} style={expanded ? { height: 'calc(100% - 40px)' } : {}} />
            {state === 'connected' && (
                <div className="px-3 py-1 text-xs text-text-muted border-t">
                    SSH session active — idle timeout: 15 min
                </div>
            )}
        </div>
    )
}
