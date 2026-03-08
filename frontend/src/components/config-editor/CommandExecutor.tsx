/**
 * CommandExecutor -- collapsible panel for executing arbitrary RouterOS
 * CLI commands inline, with command history (up/down arrow navigation).
 */

import { useState, useRef, useCallback } from 'react'
import { ChevronDown, ChevronUp, Terminal, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { configEditorApi } from '@/lib/configEditorApi'

interface CommandExecutorProps {
  tenantId: string
  deviceId: string
  currentPath: string
}

interface CommandResult {
  command: string
  success: boolean
  output: string
  timestamp: string
}

export function CommandExecutor({ tenantId, deviceId, currentPath }: CommandExecutorProps) {
  const [expanded, setExpanded] = useState(false)
  const [command, setCommand] = useState('')
  const [executing, setExecuting] = useState(false)
  const [results, setResults] = useState<CommandResult[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const executeCommand = useCallback(async () => {
    const cmd = command.trim()
    if (!cmd) return

    setExecuting(true)
    setHistory((prev) => {
      const filtered = prev.filter((h) => h !== cmd)
      return [cmd, ...filtered].slice(0, 10)
    })
    setHistoryIndex(-1)

    try {
      const result = await configEditorApi.execute(tenantId, deviceId, cmd)
      setResults((prev) => [
        {
          command: cmd,
          success: result.success,
          output: result.data
            ? result.data.map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n')).join('\n---\n')
            : result.error || 'Command executed (no output)',
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 20))
    } catch (err) {
      setResults((prev) => [
        {
          command: cmd,
          success: false,
          output: err instanceof Error ? err.message : 'Command failed',
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 20))
    } finally {
      setExecuting(false)
      setCommand('')
    }
  }, [command, tenantId, deviceId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1)
        setHistoryIndex(newIndex)
        setCommand(history[newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setCommand(history[newIndex])
      } else {
        setHistoryIndex(-1)
        setCommand('')
      }
    }
  }

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs text-text-secondary hover:text-text-secondary transition-colors"
      >
        <Terminal className="h-3.5 w-3.5" />
        <span>Command Executor</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronUp className="h-3 w-3 ml-auto" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`${currentPath}/print`}
              disabled={executing}
              className="h-7 text-xs bg-elevated/50 border-border font-mono flex-1"
            />
            <Button
              size="sm"
              onClick={executeCommand}
              disabled={executing || !command.trim()}
              className="h-7 text-xs gap-1 px-3"
            >
              {executing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Run
            </Button>
          </div>

          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {results.map((r, i) => (
                <div key={i} className="rounded border border-border bg-surface/50 p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-text-muted">{r.timestamp}</span>
                    <span className="text-xs font-mono text-text-secondary">{r.command}</span>
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded',
                        r.success
                          ? 'bg-success/20 text-success'
                          : 'bg-error/20 text-error',
                      )}
                    >
                      {r.success ? 'OK' : 'ERR'}
                    </span>
                  </div>
                  <pre className={cn(
                    'text-xs font-mono whitespace-pre-wrap break-all',
                    r.success ? 'text-text-secondary' : 'text-error',
                  )}>
                    {r.output}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
