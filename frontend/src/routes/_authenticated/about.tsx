import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RugLogo } from '@/components/brand/RugLogo'
import { APP_VERSION } from '@/lib/version'
import { AnsiNfoModal } from '@/components/about/AnsiNfoModal'
import { getLicenseStatus } from '@/lib/settingsApi'

export const Route = createFileRoute('/_authenticated/about')({
  component: AboutPage,
})

// ── Minimal QR Code Generator (no dependencies) ─────────────────────────────
// Implements a basic QR encoder for alphanumeric/byte mode, version 1-4
// Sufficient for encoding a Bitcoin address (~62 chars)

export const BTC_ADDRESS = 'bc1qfw6pmyc96vrlkpc0rgun0s7xy4sqhx7a2xurkf'

// Generate QR matrix for a given string using a minimal implementation
function generateQRMatrix(data: string): boolean[][] {
  // Use the canvas-based approach with a simple encoding
  // For a self-contained solution, we'll generate a basic QR-like pattern
  // This is a real QR encoder for small payloads

  const codewords = encodeData(data)
  const version = getMinVersion(data.length)
  const size = 17 + version * 4
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  )

  // Place finder patterns
  placeFinder(matrix, 0, 0)
  placeFinder(matrix, 0, size - 7)
  placeFinder(matrix, size - 7, 0)

  // Place timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }

  // Place alignment pattern for version >= 2
  if (version >= 2) {
    const pos = alignmentPositions[version]
    if (pos) {
      for (const r of pos) {
        for (const c of pos) {
          if (matrix[r]?.[c] === null) {
            placeAlignment(matrix, r, c)
          }
        }
      }
    }
  }

  // Dark module
  matrix[size - 8][8] = true

  // Reserve format info
  for (let i = 0; i < 8; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false
    if (matrix[i][8] === null) matrix[i][8] = false
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false
  }
  if (matrix[8][8] === null) matrix[8][8] = false

  // Place data bits
  placeData(matrix, codewords, size)

  // Apply mask (mask 0: (row + col) % 2 === 0)
  const result: boolean[][] = matrix.map((row, r) =>
    row.map((cell, c) => {
      if (cell === null) return false
      const isData = !isReserved(matrix, r, c, size, version)
      if (isData) {
        const mask = (r + c) % 2 === 0
        return mask ? !cell : (cell as boolean)
      }
      return cell as boolean
    })
  )

  // Place format info for mask 0, error correction L
  placeFormatInfo(result, size)

  return result
}

function getMinVersion(len: number): number {
  // Byte mode capacities for EC level L
  if (len <= 17) return 1
  if (len <= 32) return 2
  if (len <= 53) return 3
  return 4
}

const alignmentPositions: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
}

function placeFinder(matrix: (boolean | null)[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r
      const mc = col + c
      if (mr < 0 || mc < 0 || mr >= matrix.length || mc >= matrix.length)
        continue
      if (r === -1 || r === 7 || c === -1 || c === 7) {
        matrix[mr][mc] = false // separator
      } else if (
        r === 0 ||
        r === 6 ||
        c === 0 ||
        c === 6 ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      ) {
        matrix[mr][mc] = true
      } else {
        matrix[mr][mc] = false
      }
    }
  }
}

function placeAlignment(
  matrix: (boolean | null)[][],
  row: number,
  col: number
) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const mr = row + r
      const mc = col + c
      if (mr < 0 || mc < 0 || mr >= matrix.length || mc >= matrix.length)
        continue
      if (matrix[mr][mc] !== null) continue
      if (
        Math.abs(r) === 2 ||
        Math.abs(c) === 2 ||
        (r === 0 && c === 0)
      ) {
        matrix[mr][mc] = true
      } else {
        matrix[mr][mc] = false
      }
    }
  }
}

function encodeData(data: string): number[] {
  const version = getMinVersion(data.length)
  // Total codewords for version + EC level L
  const totalCodewords = [0, 26, 44, 70, 100][version]!
  const ecCodewords = [0, 7, 10, 15, 20][version]!
  const dataCodewords = totalCodewords - ecCodewords

  // Byte mode: mode indicator (0100) + char count + data
  const bits: number[] = []

  // Mode: byte (0100)
  pushBits(bits, 0b0100, 4)

  // Character count (8 bits for version 1-9)
  pushBits(bits, data.length, 8)

  // Data
  for (let i = 0; i < data.length; i++) {
    pushBits(bits, data.charCodeAt(i), 8)
  }

  // Terminator
  const maxBits = dataCodewords * 8
  const termLen = Math.min(4, maxBits - bits.length)
  pushBits(bits, 0, termLen)

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0)

  // Pad codewords
  const padWords = [0xec, 0x11]
  let padIdx = 0
  while (bits.length < maxBits) {
    pushBits(bits, padWords[padIdx % 2], 8)
    padIdx++
  }

  // Convert to bytes
  const dataBytes: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] || 0)
    }
    dataBytes.push(byte)
  }

  // Generate EC codewords using Reed-Solomon
  const ecBytes = generateEC(dataBytes, ecCodewords)

  return [...dataBytes, ...ecBytes]
}

function pushBits(arr: number[], value: number, count: number) {
  for (let i = count - 1; i >= 0; i--) {
    arr.push((value >> i) & 1)
  }
}

// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(function initGF() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x = x << 1
    if (x >= 256) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function generateEC(data: number[], ecLen: number): number[] {
  // Build generator polynomial
  let gen = [1]
  for (let i = 0; i < ecLen; i++) {
    const newGen = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      newGen[j] ^= gen[j]
      newGen[j + 1] ^= gfMul(gen[j], GF_EXP[i])
    }
    gen = newGen
  }

  const result = new Array(ecLen).fill(0)
  const msg = [...data, ...result]

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i]
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef)
      }
    }
  }

  return msg.slice(data.length)
}

function isReserved(
  _matrix: (boolean | null)[][],
  r: number,
  c: number,
  size: number,
  version: number
): boolean {
  // Finder + separator areas
  if (r <= 8 && c <= 8) return true
  if (r <= 8 && c >= size - 8) return true
  if (r >= size - 8 && c <= 8) return true

  // Timing
  if (r === 6 || c === 6) return true

  // Dark module
  if (r === size - 8 && c === 8) return true

  // Alignment patterns (version >= 2)
  if (version >= 2) {
    const pos = alignmentPositions[version]
    if (pos) {
      for (const ar of pos) {
        for (const ac of pos) {
          if (ar <= 8 && ac <= 8) continue
          if (ar <= 8 && ac >= size - 8) continue
          if (ar >= size - 8 && ac <= 8) continue
          if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true
        }
      }
    }
  }

  return false
}

function placeData(
  matrix: (boolean | null)[][],
  codewords: number[],
  size: number
) {
  let bitIdx = 0
  const totalBits = codewords.length * 8

  let col = size - 1
  let upward = true

  while (col >= 0) {
    if (col === 6) col-- // skip timing column

    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i)

    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc
        if (c < 0 || c >= size) continue
        if (matrix[row][c] !== null) continue

        if (bitIdx < totalBits) {
          const byteIdx = Math.floor(bitIdx / 8)
          const bitPos = 7 - (bitIdx % 8)
          matrix[row][c] = ((codewords[byteIdx] >> bitPos) & 1) === 1
          bitIdx++
        } else {
          matrix[row][c] = false
        }
      }
    }

    col -= 2
    upward = !upward
  }
}

function placeFormatInfo(matrix: boolean[][], size: number) {
  // Format info for EC level L (01) and mask 0 (000) = 01000
  // After BCH: 0x77c0... Let's use the precomputed value
  // EC L = 01, mask 0 = 000 -> data = 01000
  // Format string after BCH and XOR with 101010000010010:
  // const formatBits = 0x77c0 // L, mask 0 (unused, computed via getFormatInfo below)
  // Actually, let's compute it properly
  // data = 01 000 = 0b01000 = 8
  // Generator: 10100110111 (0x537)
  // BCH encode then XOR with mask pattern
  const formatInfo = getFormatInfo(0, 0) // ecl=L(01->index 0 in our simplified), mask=0

  // Place format info
  const bits: boolean[] = []
  for (let i = 14; i >= 0; i--) {
    bits.push(((formatInfo >> i) & 1) === 1)
  }

  // Around top-left finder
  const positions1 = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ]

  // Around other finders
  const positions2 = [
    [size - 1, 8],
    [size - 2, 8],
    [size - 3, 8],
    [size - 4, 8],
    [size - 5, 8],
    [size - 6, 8],
    [size - 7, 8],
    [8, size - 8],
    [8, size - 7],
    [8, size - 6],
    [8, size - 5],
    [8, size - 4],
    [8, size - 3],
    [8, size - 2],
    [8, size - 1],
  ]

  for (let i = 0; i < 15; i++) {
    const [r1, c1] = positions1[i]
    matrix[r1][c1] = bits[i]
    const [r2, c2] = positions2[i]
    matrix[r2][c2] = bits[i]
  }
}

function getFormatInfo(_ecl: number, mask: number): number {
  // Pre-computed format info strings for EC level L with each mask
  // EC Level L = 01
  const formatInfoL = [
    0x77c4, // mask 0
    0x72f3, // mask 1
    0x7daa, // mask 2
    0x789d, // mask 3
    0x662f, // mask 4
    0x6318, // mask 5
    0x6c41, // mask 6
    0x6976, // mask 7
  ]
  return formatInfoL[mask] ?? 0x77c4
}

// ── QR Canvas Component ──────────────────────────────────────────────────────

function QRCode({
  data,
  size = 200,
  fgColor = '#e2e8f0',
  bgColor = 'transparent',
}: {
  data: string
  size?: number
  fgColor?: string
  bgColor?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const matrix = generateQRMatrix(data)
      const moduleCount = matrix.length
      const moduleSize = size / moduleCount

      canvas.width = size
      canvas.height = size

      // Background
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, size, size)

      // Modules
      ctx.fillStyle = fgColor
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (matrix[r][c]) {
            ctx.fillRect(
              Math.floor(c * moduleSize),
              Math.floor(r * moduleSize),
              Math.ceil(moduleSize),
              Math.ceil(moduleSize)
            )
          }
        }
      }
    } catch {
      // Fallback: draw a placeholder
      canvas.width = size
      canvas.height = size
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = fgColor
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('QR Code', size / 2, size / 2)
    }
  }, [data, size, fgColor, bgColor])

  return <canvas ref={canvasRef} width={size} height={size} className="rounded" />
}

// ── About Page ───────────────────────────────────────────────────────────────

function AboutPage() {
  const [copied, setCopied] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [showNfo, setShowNfo] = useState(false)
  const { data: license } = useQuery({ queryKey: ['license-status'], queryFn: getLicenseStatus })

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(BTC_ADDRESS)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea')
      el.value = BTC_ADDRESS
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <RugLogo size={64} />
        <h1 className="text-2xl font-bold text-text-primary">TOD - The Other Dude</h1>
        <p className="text-text-secondary">
          MSP fleet management platform for RouterOS devices
        </p>
        <span className="inline-block px-3 py-1 text-xs font-mono font-medium text-accent bg-accent-muted rounded-full">
          {APP_VERSION}
        </span>
      </div>

      {/* License */}
      {license && (
        <div className="rounded-lg border border-border bg-surface p-5 space-y-2">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            License
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">
              {license.tier === 'commercial' ? 'Commercial License' : 'BSL 1.1 — Free Tier'}
            </span>
            <span className={`text-sm font-mono ${license.over_limit ? 'text-error' : 'text-text-secondary'}`}>
              {license.actual_devices} / {license.licensed_devices === 0 ? 'Unlimited' : license.licensed_devices} devices
            </span>
          </div>
          {license.over_limit && (
            <p className="text-xs text-error">
              Device count exceeds licensed limit. A commercial license is required.
            </p>
          )}
        </div>
      )}

      {/* Features summary */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Platform
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm text-text-secondary">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Multi-tenant with RLS
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            RouterOS binary API
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Real-time monitoring
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Safe config push
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            Certificate authority
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            WireGuard VPN
          </div>
        </div>
      </div>

      {/* Support Development */}
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Support Development
        </h2>
        <p className="text-sm text-text-muted">
          The Other Dude is free and open-source. If you find it valuable,
          voluntary Bitcoin contributions are appreciated but never expected.
        </p>

        <button
          onClick={() => setShowQR(!showQR)}
          className="text-xs text-accent hover:underline"
        >
          {showQR ? 'Hide donation address' : 'Show donation address'}
        </button>

        {showQR && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-3 rounded-lg bg-background border border-border">
              <QRCode
                data={`bitcoin:${BTC_ADDRESS}`}
                size={160}
                fgColor="hsl(215 20.2% 75.1%)"
                bgColor="transparent"
              />
            </div>

            <div className="w-full space-y-2">
              <p className="text-xs text-text-muted text-center">Bitcoin Address</p>
              <button
                onClick={copyAddress}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-background border border-border text-xs font-mono text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors cursor-pointer"
                title="Click to copy"
              >
                <span className="truncate">{BTC_ADDRESS}</span>
                <span className="flex-shrink-0 text-text-muted">
                  {copied ? (
                    <svg
                      className="w-4 h-4 text-success"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center space-y-2">
        <p className="text-xs text-text-muted">
          Not affiliated with or endorsed by MikroTik (SIA Mikrotikls)
        </p>
        <button
          onClick={() => setShowNfo(true)}
          className="text-[10px] font-mono text-text-muted/40 hover:text-accent transition-colors cursor-pointer"
        >
          ANSI
        </button>
      </div>

      <AnsiNfoModal open={showNfo} onOpenChange={setShowNfo} />
    </div>
  )
}
