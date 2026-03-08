import { useEffect } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Monitor,
  Building2,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  BellRing,
  Download,
  Terminal,
  FileCode,
  FileText,
  MapPin,
  LayoutDashboard,
  Network,
  Wrench,
  ClipboardList,
  Calendar,
  Key,
  Layers,
  Shield,
  ShieldCheck,

  Eye,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { AlertBadge } from '@/components/alerts/AlertBadge'
import { RugLogo } from '@/components/brand/RugLogo'

interface NavItem {
  label: string
  href: string
  icon: React.FC<{ className?: string }>
  exact?: boolean
  badge?: React.ReactNode
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
          label: 'Dashboard',
          href: '/',
          icon: LayoutDashboard,
          exact: true,
        },
        // Only show Devices for non-super_admin (super_admin uses Organizations in Admin)
        ...(!isSuperAdmin(user) && user?.tenant_id
          ? [
              {
                label: 'Devices',
                href: `/tenants/${user.tenant_id}/devices`,
                icon: Monitor,
              },
            ]
          : []),
        {
          label: 'Map',
          href: '/map',
          icon: MapPin,
        },
      ],
    },
    {
      label: 'Manage',
      visible: true,
      items: [
        {
          label: 'Config Editor',
          href: '/config-editor',
          icon: Terminal,
        },
        {
          label: 'Batch Config',
          href: '/batch-config',
          icon: Wrench,
        },
        {
          label: 'Bulk Commands',
          href: '/bulk-commands',
          icon: Layers,
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
        {
          label: 'Maintenance',
          href: '/maintenance',
          icon: Calendar,
        },
        {
          label: 'VPN',
          href: '/vpn',
          icon: Shield,
        },
        {
          label: 'Certificates',
          href: '/certificates',
          icon: ShieldCheck,
        },

      ],
    },
    {
      label: 'Monitor',
      visible: true,
      items: [
        {
          label: 'Topology',
          href: '/topology',
          icon: Network,
        },
        {
          label: 'Alerts',
          href: '/alerts',
          icon: Bell,
          badge: <AlertBadge />,
        },
        {
          label: 'Alert Rules',
          href: '/alert-rules',
          icon: BellRing,
        },
        {
          label: 'Audit Trail',
          href: '/audit',
          icon: ClipboardList,
        },
        ...(isTenantAdmin(user)
          ? [
              {
                label: 'Transparency',
                href: '/transparency',
                icon: Eye,
              },
            ]
          : []),
        {
          label: 'Reports',
          href: '/reports',
          icon: FileText,
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
          label: 'API Keys',
          href: '/settings/api-keys',
          icon: Key,
        },
        {
          label: 'Settings',
          href: '/settings',
          icon: Settings,
        },
        {
          label: 'About',
          href: '/about',
          icon: Info,
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
      <nav className="flex-1 py-2 overflow-y-auto">
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
                      ? 'bg-accent-muted text-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-elevated/50',
                    showCollapsed && 'justify-center px-0',
                  )}
                  title={showCollapsed ? item.label : undefined}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {!showCollapsed && (
                    <>
                      <span className="truncate">{item.label}</span>
                      {item.badge && <span className="ml-auto">{item.badge}</span>}
                    </>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

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
        className={cn(
          'hidden lg:flex flex-col border-r border-border bg-sidebar transition-all duration-200',
          sidebarCollapsed ? 'w-12' : 'w-60',
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
          <aside className="lg:hidden fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-sidebar border-r border-border shadow-xl">
            {sidebarContent(false)}
          </aside>
        </>
      )}
    </>
  )
}
