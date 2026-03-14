/**
 * useSimpleConfigMode -- Per-device Simple/Standard mode toggle with localStorage persistence.
 *
 * Each device independently stores its mode preference. Default is 'standard' (opt-in to Simple).
 */

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'tod-simple-mode'

type ConfigMode = 'simple' | 'standard'

function readPrefs(): Record<string, ConfigMode> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? (JSON.parse(stored) as Record<string, ConfigMode>) : {}
  } catch {
    return {}
  }
}

export function useSimpleConfigMode(deviceId: string) {
  const [mode, setMode] = useState<ConfigMode>(() => {
    const prefs = readPrefs()
    return prefs[deviceId] ?? 'standard'
  })

  const toggleMode = useCallback(
    (newMode: ConfigMode) => {
      setMode(newMode)
      const prefs = readPrefs()
      prefs[deviceId] = newMode
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    },
    [deviceId],
  )

  return { mode, toggleMode }
}
