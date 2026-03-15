import { useEffect, useRef } from 'react'

/**
 * Hook to register a single-key keyboard shortcut.
 * Skips when focus is in INPUT, TEXTAREA, or contentEditable elements.
 */
export function useShortcut(key: string, callback: () => void, enabled = true) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return

      if (e.key === key) {
        e.preventDefault()
        callbackRef.current()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, enabled])
}

/**
 * Hook to register a two-key sequence shortcut (e.g., "g" then "d").
 * The second key must be pressed within 1 second of the first.
 * Skips when focus is in INPUT, TEXTAREA, or contentEditable elements.
 */
export function useSequenceShortcut(
  keys: [string, string],
  callback: () => void,
  enabled = true,
) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })
  const pendingRef = useRef<string | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return

      if (pendingRef.current === keys[0] && e.key === keys[1]) {
        e.preventDefault()
        pendingRef.current = null
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        callbackRef.current()
      } else if (e.key === keys[0]) {
        pendingRef.current = keys[0]
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = window.setTimeout(() => {
          pendingRef.current = null
        }, 1000)
      } else {
        pendingRef.current = null
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [keys[0], keys[1], enabled])
}
