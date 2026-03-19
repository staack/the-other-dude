import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { APP_VERSION } from '@/lib/version'

// ── ANSI Art Content ────────────────────────────────────────────────────────
// Each line is a tuple: [colorClass, text]
// Colors reference Deep Space theme via Tailwind utilities

const BTC_ADDRESS = 'bc1qfw6pmyc96vrlkpc0rgun0s7xy4sqhx7a2xurkf'

type ArtLine = [className: string, text: string]

function buildNfoLines(): ArtLine[] {
  const accent = 'text-accent'
  const dim = 'text-text-muted'
  const secondary = 'text-text-secondary'
  const primary = 'text-text-primary'
  const bar = '═'.repeat(72)

  return [
    [accent, ''],
    [accent, '  ████████╗  ██████╗  ██████╗ '],
    [accent, '  ╚══██╔══╝ ██╔═══██╗ ██╔══██╗'],
    [accent, '     ██║    ██║   ██║ ██║  ██║'],
    [accent, '     ██║    ██║   ██║ ██║  ██║'],
    [accent, '     ██║    ╚██████╔╝ ██████╔╝'],
    [accent, '     ╚═╝     ╚═════╝  ╚═════╝ '],
    [accent, ''],
    [dim, `  ${bar}`],
    [accent, ''],
    [primary, '  ▓▒░  T H E   O T H E R   D U D E  ░▒▓'],
    [secondary, `  ${APP_VERSION} · MSP Fleet Management for RouterOS`],
    [accent, ''],
    [dim, `  ${bar}`],
    [dim, '  ░░░ LICENSE ░░░'],
    [dim, `  ${bar}`],
    [accent, ''],
    [primary, '  Business Source License 1.1'],
    [accent, ''],
    [secondary, '  ► Free self-hosted production use up to 1,000 devices'],
    [secondary, '  ► SaaS offering requires commercial agreement'],
    [secondary, '  ► Converts to Apache License 2.0 on March 8, 2030'],
    [accent, ''],
    [dim, '  For commercial licensing:  license@theotherdude.net'],
    [dim, '  For support:              support@theotherdude.net'],
    [accent, ''],
    [dim, `  ${bar}`],
    [dim, '  ░░░ TECH STACK ░░░'],
    [dim, `  ${bar}`],
    [accent, ''],
    [secondary, '  ► Backend ......... Python / FastAPI / PostgreSQL'],
    [secondary, '  ► Frontend ........ React / TanStack Router / Tailwind'],
    [secondary, '  ► Messaging ....... NATS JetStream'],
    [secondary, '  ► VPN ............. WireGuard'],
    [secondary, '  ► Deployment ...... Docker Compose / Helm'],
    [secondary, '  ► Router Comms .... RouterOS Binary API'],
    [accent, ''],
    [dim, `  ${bar}`],
    [dim, '  ░░░ CREDITS ░░░'],
    [dim, `  ${bar}`],
    [accent, ''],
    [primary, '  Jason Staack'],
    [secondary, '  Built with AI assistance'],
    [accent, ''],
    [dim, `  BTC: ${BTC_ADDRESS}`],
    [accent, ''],
    [dim, `  ${bar}`],
    [accent, ''],
    [accent, '  ░▒▓█  t h e o t h e r d u d e . n e t  █▓▒░'],
    [accent, ''],
    [dim, '  "Because every MSP needs one."'],
    [accent, ''],
  ]
}

// ── Component ───────────────────────────────────────────────────────────────

interface AnsiNfoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AnsiNfoModal({ open, onOpenChange }: AnsiNfoModalProps) {
  const [visibleLines, setVisibleLines] = useState(0)
  const [animationDone, setAnimationDone] = useState(false)
  const linesRef = useRef<ArtLine[]>(buildNfoLines())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const totalLines = linesRef.current.length

  const skipAnimation = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setVisibleLines(totalLines)
    setAnimationDone(true)
  }, [totalLines])

  // Start animation when modal opens
  useEffect(() => {
    if (!open) {
      // Reset on close
      setVisibleLines(0)
      setAnimationDone(false)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Animate lines in
    let count = 0
    intervalRef.current = setInterval(() => {
      count++
      setVisibleLines(count)
      if (count >= totalLines) {
        clearInterval(intervalRef.current!)
        intervalRef.current = null
        setAnimationDone(true)
      }
    }, 15)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [open, totalLines])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[80ch] w-[95vw] p-0 gap-0 bg-background border-border overflow-hidden"
        onKeyDown={(e) => {
          if (!animationDone && e.key !== 'Escape') {
            skipAnimation()
          }
        }}
        onClick={() => {
          if (!animationDone) skipAnimation()
        }}
      >
        {/* Retro title bar */}
        <div className="flex items-center justify-between px-3 pr-10 py-1.5 bg-surface border-b border-border font-mono text-xs">
          <DialogTitle id="ansi-nfo-title" className="text-text-muted text-xs font-normal font-mono">
            TOD.NFO — ACiD View v1.0
          </DialogTitle>
        </div>

        {/* Terminal body */}
        <div
          className="overflow-y-auto p-4 max-h-[70vh] font-mono text-[10px] sm:text-xs md:text-sm leading-relaxed"
          role="document"
          aria-labelledby="ansi-nfo-title"
        >
          <pre className="whitespace-pre" aria-hidden="true">
            {linesRef.current.slice(0, visibleLines).map(([cls, text], i) => (
              <span key={i} className={`block ${cls}`}>
                {text || '\u00A0'}
              </span>
            ))}
          </pre>
          {/* Screen-reader accessible version */}
          <div className="sr-only">
            <p>The Other Dude, {APP_VERSION}. MSP Fleet Management for RouterOS.</p>
            <p>Business Source License 1.1. Free self-hosted production use up to 1000 devices. SaaS requires commercial agreement. Converts to Apache 2.0 on March 8 2030.</p>
            <p>Built by Jason Staack with AI assistance.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
