import { type ReactNode, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { Toaster } from '@/components/ui/toast'
import { useUIStore } from '@/lib/store'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  // Apply persisted UI scale on mount
  const uiScale = useUIStore((s) => s.uiScale)
  useEffect(() => {
    document.documentElement.style.zoom = `${uiScale}%`
  }, [uiScale])
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-accent focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto p-5">
          {children}
        </main>
      </div>
      <Toaster />
      <CommandPalette />
      <ShortcutsDialog />
    </div>
  )
}
