const THEME_STORAGE_KEY = 'tod-ui-state'

export type Theme = 'dark' | 'light'

/**
 * Apply theme class to <html> element.
 * Called both during initialization and on toggle.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

/**
 * Determine initial theme:
 * 1. Check localStorage for saved preference
 * 2. Fall back to prefers-color-scheme
 * 3. Default to dark (network operators prefer it)
 *
 * Called BEFORE React renders to prevent flash of wrong theme.
 */
export function initializeTheme(): void {
  let theme: Theme = 'dark' // default

  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed?.state?.theme === 'light' || parsed?.state?.theme === 'dark') {
        theme = parsed.state.theme
      }
    } else {
      // No saved preference -- respect OS preference
      if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        theme = 'light'
      }
    }
  } catch {
    // localStorage unavailable or corrupt -- use default
  }

  applyTheme(theme)
}
