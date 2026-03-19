import { useEffect, useRef } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Monitor,
  Building2,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Download,
  Terminal,
  FileCode,
  LayoutDashboard,
  ClipboardList,
  Wifi,
  BarChart3,
  MapPin,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { RugLogo } from '@/components/brand/RugLogo'

interface NavItem {
  label: string
  href: string
  icon: React.FC<{ className?: string }>
  exact?: boolean
}

interface NavSection {
  label: string
  items: NavItem[]
  visible: boolean
}

export function Sidebar() {
  const { user } = useAuth()
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // Mobile sidebar focus trap
  useEffect(() => {
    if (!mobileSidebarOpen) return

    const sidebar = document.getElementById('mobile-sidebar')
    if (!sidebar) return

    const focusable = sidebar.querySelectorAll<HTMLElement>('a, button, input')
    if (focusable.length) focusable[0].focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileSidebarOpen(false)
        return
      }
      if (e.key === 'Tab') {
        const els = sidebar!.querySelectorAll<HTMLElement>('a, button, input')
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileSidebarOpen, setMobileSidebarOpen])

  const navRef = useRef<HTMLElement>(null)

  // Keyboard toggle: [ key collapses/expands sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '[' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

  const sections: NavSection[] = [
    {
      label: 'Fleet',
      visible: true,
      items: [
        {
          label: 'Overview',
          href: '/',
          icon: LayoutDashboard,
          exact: true,
        },
        // Only show Devices for non-super_admin with a tenant_id
        ...(!isSuperAdmin(user) && user?.tenant_id
          ? [
              {
                label: 'Devices',
                href: `/tenants/${user.tenant_id}/devices`,
                icon: Monitor,
              },
            ]
          : []),
        ...(!isSuperAdmin(user) && user?.tenant_id
          ? [
              {
                label: 'Sites',
                href: `/tenants/${user.tenant_id}/sites`,
                icon: MapPin,
              },
            ]
          : []),
        ...(!isSuperAdmin(user) && user?.tenant_id
          ? [{
              label: 'Wireless Links',
              href: `/tenants/${user.tenant_id}/wireless-links`,
              icon: Wifi,
            }]
          : [{
              label: 'Wireless Links',
              href: '/wireless',
              icon: Wifi,
            }]
        ),
        {
          label: 'Traffic',
          href: '/traffic',
          icon: BarChart3,
        },
      ],
    },
    {
      label: 'Config',
      visible: true,
      items: [
        {
          label: 'Editor',
          href: '/config-editor',
          icon: Terminal,
        },
        {
          label: 'Templates',
          href: '/templates',
          icon: FileCode,
        },
        {
          label: 'Firmware',
          href: '/firmware',
          icon: Download,
        },
      ],
    },
    {
      label: 'Admin',
      visible: isSuperAdmin(user) || isTenantAdmin(user),
      items: [
        ...(isTenantAdmin(user) && user?.tenant_id
          ? [
              {
                label: 'Users',
                href: `/tenants/${user.tenant_id}/users`,
                icon: Users,
              },
            ]
          : []),
        ...(isSuperAdmin(user) || isTenantAdmin(user)
          ? [
              {
                label: 'Organizations',
                href: '/tenants',
                icon: Building2,
              },
            ]
          : []),
        {
          label: 'Audit Log',
          href: '/audit',
          icon: ClipboardList,
        },
        {
          label: 'Settings',
          href: '/settings',
          icon: Settings,
        },
      ],
    },
  ]

  const visibleSections = sections.filter((s) => s.visible)

  const isActive = (item: NavItem) => {
    if (item.exact) return currentPath === item.href
    // Settings should only match exact to avoid catching everything
    if (item.href === '/settings') return currentPath === '/settings' || currentPath.startsWith('/settings/')
    return currentPath.startsWith(item.href) && item.href.length > 1
  }

  const sidebarContent = (showCollapsed: boolean) => (
    <>
      {/* Logo */}
      <div
        className={cn(
          'flex items-center h-12 px-3 border-b border-border',
          showCollapsed ? 'justify-center' : 'gap-2',
        )}
      >
        <RugLogo size={showCollapsed ? 24 : 28} className="flex-shrink-0" />
        {!showCollapsed && (
          <span className="text-sm font-semibold text-text-primary truncate">
            TOD
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav ref={navRef} data-slot="fleet-nav" className="flex-1 py-2 overflow-y-auto">
        {visibleSections.map((section, sectionIdx) => (
          <div key={section.label}>
            {showCollapsed && sectionIdx > 0 && (
              <div className="mx-2 my-1 border-t border-border" />
            )}
            {!showCollapsed && (
              <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon
              const active = isActive(item)
              return (
                <Link
                  key={`${section.label}-${item.label}`}
                  to={item.href}
                  onClick={() => setMobileSidebarOpen(false)}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-sm transition-colors min-h-[44px]',
                    active
                      ? 'bg-[hsl(var(--accent-muted))] text-accent rounded-md'
                      : 'text-text-muted hover:text-text-primary hover:bg-elevated/50 rounded-md',
                    showCollapsed && 'justify-center px-0',
                  )}
                  title={showCollapsed ? item.label : undefined}
                  aria-label={showCollapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  {!showCollapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Version identifier */}
      {!showCollapsed && (
        <div className="px-3 py-1 text-center">
          <span className="font-mono text-[9px] text-text-muted">TOD v9.5</span>
        </div>
      )}

      {/* Collapse toggle (hidden on mobile) */}
      <button
        onClick={toggleSidebar}
        className="hidden lg:flex items-center justify-center h-10 border-t border-border text-text-muted hover:text-text-secondary transition-colors"
        title={showCollapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
        aria-label={showCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        data-testid="sidebar-toggle"
      >
        {showCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        data-testid="sidebar"
        data-sidebar
        className={cn(
          'hidden lg:flex flex-col border-r border-border bg-sidebar transition-all duration-200',
          sidebarCollapsed ? 'w-14' : 'w-[180px]',
        )}
      >
        {sidebarContent(sidebarCollapsed)}
      </aside>

      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside
            id="mobile-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="lg:hidden fixed inset-y-0 left-0 z-50 w-[180px] flex flex-col bg-sidebar border-r border-border"
          >
            {sidebarContent(false)}
          </aside>
        </>
      )}
    </>
  )
}
