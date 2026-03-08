export interface ShortcutDef {
  key: string // Display key(s): "?", "g d", "j", "Cmd+K"
  description: string // What it does
  category: 'global' | 'navigation' | 'device-list'
}

export const shortcuts: ShortcutDef[] = [
  // Global
  { key: '?', description: 'Show keyboard shortcuts', category: 'global' },
  { key: 'Cmd+K', description: 'Open command palette', category: 'global' },
  { key: '[', description: 'Toggle sidebar', category: 'global' },

  // Navigation (g prefix = "go to")
  { key: 'g d', description: 'Go to Dashboard', category: 'navigation' },
  { key: 'g a', description: 'Go to Alerts', category: 'navigation' },
  { key: 'g t', description: 'Go to Topology', category: 'navigation' },
  { key: 'g f', description: 'Go to Firmware', category: 'navigation' },

  // Device list
  { key: 'j', description: 'Next device', category: 'device-list' },
  { key: 'k', description: 'Previous device', category: 'device-list' },
  { key: 'Enter', description: 'Open selected device', category: 'device-list' },
]

export const categoryLabels: Record<ShortcutDef['category'], string> = {
  global: 'Global',
  navigation: 'Navigation',
  'device-list': 'Device List',
}
