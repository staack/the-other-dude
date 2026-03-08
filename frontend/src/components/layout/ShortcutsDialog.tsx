import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { shortcuts, categoryLabels, type ShortcutDef } from '@/lib/shortcuts'
import { ShortcutHint } from '@/components/ui/shortcut-hint'
import { useShortcut } from '@/hooks/useShortcut'

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false)

  // ? key opens the shortcuts dialog
  useShortcut('?', () => setOpen(true))

  // Group shortcuts by category
  const grouped = shortcuts.reduce<
    Record<ShortcutDef['category'], ShortcutDef[]>
  >(
    (acc, shortcut) => {
      acc[shortcut.category].push(shortcut)
      return acc
    },
    { global: [], navigation: [], 'device-list': [] },
  )

  const categories: ShortcutDef['category'][] = [
    'global',
    'navigation',
    'device-list',
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {categories.map((category) => {
            const items = grouped[category]
            if (items.length === 0) return null
            return (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  {categoryLabels[category]}
                </h3>
                <div className="space-y-1">
                  {items.map((shortcut) => (
                    <div
                      key={shortcut.key}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-elevated/50"
                    >
                      <span className="text-sm text-text-secondary">
                        {shortcut.description}
                      </span>
                      <ShortcutHint keys={shortcut.key} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
