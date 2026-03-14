import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyTheme } from './theme'

interface UIState {
  selectedTenantId: string | null
  sidebarCollapsed: boolean
  mobileSidebarOpen: boolean
  theme: 'dark' | 'light'

  setSelectedTenantId: (id: string | null) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setMobileSidebarOpen: (open: boolean) => void
  setTheme: (theme: 'dark' | 'light') => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedTenantId: null,
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      theme: 'dark',

      setSelectedTenantId: (id) => set({ selectedTenantId: id }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
    }),
    {
      name: 'tod-ui-state',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        selectedTenantId: state.selectedTenantId,
      }),
    },
  ),
)
