import { useCallback, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

/**
 * Valid characters for the Secret Key: 22 letters + 8 digits = 30 chars.
 * Uppercase only, ambiguous characters removed (O, I, L, S, 0, 1).
 */
const VALID_CHARS = /^[ABCDEFGHJKMNPQRTUVWXYZ23456789]+$/

interface SecretKeyInputProps {
  value: string
  onChange: (value: string) => void
  error?: boolean
}

/**
 * Secret Key entry component with 5 grouped inputs matching A3-XXXXXX format.
 *
 * The "A3" prefix is shown as a static label. The user enters 5 groups of
 * 6 characters each. Auto-advances to the next group on fill, supports
 * paste of the full key across all groups, and validates characters.
 */
export function SecretKeyInput({ value, onChange, error }: SecretKeyInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Parse the value into 5 groups (strip "A3-" prefix and hyphens)
  const parseGroups = useCallback((raw: string): string[] => {
    const cleaned = raw
      .replace(/^A3[-\s]*/i, '')
      .replace(/[-\s]/g, '')
      .toUpperCase()
    const groups: string[] = []
    for (let i = 0; i < 5; i++) {
      groups.push(cleaned.slice(i * 6, (i + 1) * 6))
    }
    return groups
  }, [])

  const [groups, setGroups] = useState<string[]>(() => parseGroups(value))

  // Reconstruct the full key from groups
  const buildKey = useCallback((g: string[]) => {
    const joined = g.join('')
    if (joined.length === 0) return ''
    return `A3-${g.filter(Boolean).join('-')}`
  }, [])

  const handleGroupChange = useCallback(
    (index: number, input: string) => {
      // Allow only valid charset characters
      const filtered = input
        .toUpperCase()
        .split('')
        .filter((c) => VALID_CHARS.test(c))
        .join('')
        .slice(0, 6)

      const newGroups = [...groups]
      newGroups[index] = filtered
      setGroups(newGroups)
      onChange(buildKey(newGroups))

      // Auto-advance to next group when this one is full
      if (filtered.length === 6 && index < 4) {
        inputRefs.current[index + 1]?.focus()
      }
    },
    [groups, onChange, buildKey],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text')
      const parsed = parseGroups(pasted)

      // Only apply if we got meaningful data
      if (parsed.some((g) => g.length > 0)) {
        setGroups(parsed)
        onChange(buildKey(parsed))

        // Focus the first incomplete group
        const incompleteIdx = parsed.findIndex((g) => g.length < 6)
        if (incompleteIdx >= 0) {
          inputRefs.current[incompleteIdx]?.focus()
        } else {
          // All complete -- focus last
          inputRefs.current[4]?.focus()
        }
      }
    },
    [parseGroups, onChange, buildKey],
  )

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      // Navigate back on Backspace when group is empty
      if (e.key === 'Backspace' && groups[index] === '' && index > 0) {
        e.preventDefault()
        inputRefs.current[index - 1]?.focus()
      }
    },
    [groups],
  )

  // 26-char key = 4 groups of 6 + 1 group of 2
  const isComplete =
    groups.slice(0, 4).every((g) => g.length === 6) && groups[4].length >= 2
  const hasContent = groups.some((g) => g.length > 0)

  const borderColor = error
    ? 'border-error'
    : isComplete
      ? 'border-success'
      : hasContent
        ? 'border-warning'
        : 'border-border'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap" onPaste={handlePaste}>
        {/* Static A3 prefix */}
        <span className="text-xs font-mono font-semibold text-text-secondary select-none shrink-0">
          A3
        </span>
        <span className="text-text-muted select-none text-xs">-</span>

        {/* 5 input groups */}
        {groups.map((group, idx) => (
          <div key={idx} className="flex items-center gap-1">
            {idx > 0 && <span className="text-text-muted select-none text-xs">-</span>}
            <Input
              ref={(el) => {
                inputRefs.current[idx] = el
              }}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={6}
              value={group}
              onChange={(e) => handleGroupChange(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              className={`w-[3.25rem] font-mono text-center text-xs tracking-wide uppercase px-0.5 ${borderColor}`}
              placeholder="------"
            />
          </div>
        ))}
      </div>
      {error && hasContent && !isComplete && (
        <p className="text-xs text-error">
          Enter all 30 characters of your Secret Key
        </p>
      )}
    </div>
  )
}
