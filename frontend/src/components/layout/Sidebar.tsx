import { useEffect, useRef } from 'react'
import { APP_VERSION } from '@/lib/version'
import { Link, useRouterState, useNavigate } from '@tanstack/react-router'
import {
  Monitor,
  Building2,
  Users,
  Settings,
  LayoutDashboard,
  Wifi,
  MapPin,
  Bell,
  Map,
  Terminal,
  FileCode,
  Download,
  Wrench,
  ClipboardList,
  BellRing,
  Calendar,
  FileBarChart,
  ShieldCheck,
  KeyRound,
  Sun,
  Moon,
  LogOut,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { useEventStreamContext } from '@/contexts/EventStreamContext'
import { alertEventsApi, tenantsApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { RugLogo } from '@/components/brand/RugLogo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ConnectionState } from '@/hooks/useEventStream'

// ─── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: React.FC<{ className?: string }>
  exact?: boolean
  badge?: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const navItemBase =
  'flex items-center gap-2 text-[13px] py-[5px] px-2 pl-[10px] border-l-2 border-transparent transition-[border-color,color] duration-[50ms] linear'

const navItemInactive =
  'text-text-secondary hover:border-accent'

const navItemActive =
  'text-text-primary font-medium border-accent bg-accent-soft rounded-r-sm'

const lowFreqBase =
  'flex items-center gap-2 text-[13px] text-text-muted py-[3px] px-2 pl-[10px] border-l-2 border-transparent transition-[border-color,color] duration-[50ms] linear hover:border-accent'

const iconClass = 'h-4 w-4 text-text-muted flex-shrink-0'

// ─── Component ──────────────────────────────────────────────────────────────

export function Sidebar() {
  const { user, logout } = useAuth()
  const {
    sidebarCollapsed,
    toggleSidebar,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    selectedTenantId,
    setSelectedTenantId,
    theme,
    setTheme,
    uiScale,
    setUIScale,
  } = useUIStore()
  const { connectionState } = useEventStreamContext()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const navigate = useNavigate()
  const navRef = useRef<HTMLElement>(null)

  const superAdmin = isSuperAdmin(user)
  const tenantAdmin = isTenantAdmin(user)
  const tenantId = superAdmin ? selectedTenantId : user?.tenant_id

  // ─── Queries ────────────────────────────────────────────────────────────

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    enabled: superAdmin,
    select: (data) => data.filter((t) => t.id !== SYSTEM_TENANT_ID),
  })

  const selectedTenant = tenants?.find((t) => t.id === selectedTenantId)

  // Auto-select when there's exactly one tenant and nothing selected
  useEffect(() => {
    if (superAdmin && tenants && tenants.length === 1 && !selectedTenantId) {
      setSelectedTenantId(tenants[0].id)
    }
  }, [tenants, selectedTenantId, superAdmin, setSelectedTenantId])

  const { data: alertCount } = useQuery({
    queryKey: ['alert-active-count', tenantId],
    queryFn: () => alertEventsApi.activeCount(tenantId!),
    enabled: !!tenantId,
    refetchInterval: 30_000,
  })

  // ─── Tenant display name ───────────────────────────────────────────────

  const tenantName = superAdmin
    ? (selectedTenant?.name ?? 'All Orgs')
    : (user?.name ?? user?.email ?? 'Tenant')

  // ─── Nav items ────────────────────────────────────────────────────────

  const operateItems: NavItem[] = [
    { label: 'Overview', href: '/', icon: LayoutDashboard, exact: true },
    ...(!superAdmin && user?.tenant_id
      ? [
          { label: 'Devices', href: `/tenants/${user.tenant_id}/devices`, icon: Monitor },
          { label: 'Sites', href: `/tenants/${user.tenant_id}/sites`, icon: MapPin },
        ]
      : []),
    {
      label: 'Alerts',
      href: '/alerts',
      icon: Bell,
      badge: alertCount && alertCount > 0 ? alertCount : undefined,
    },
    ...(!superAdmin && user?.tenant_id
      ? [{ label: 'Wireless', href: `/tenants/${user.tenant_id}/wireless-links`, icon: Wifi }]
      : [{ label: 'Wireless', href: '/wireless', icon: Wifi }]
    ),
    { label: 'Map', href: '/map', icon: Map },
  ]

  const actItems: NavItem[] = [
    { label: 'Config', href: '/config-editor', icon: Terminal },
    { label: 'Templates', href: '/templates', icon: FileCode },
    { label: 'Firmware', href: '/firmware', icon: Download },
    { label: 'Commands', href: '/bulk-commands', icon: Wrench },
  ]

  const lowFreqItems: NavItem[] = [
    ...(superAdmin || tenantAdmin
      ? [{ label: 'Organizations', href: '/tenants', icon: Building2 }]
      : []),
    ...(tenantAdmin && user?.tenant_id
      ? [{ label: 'Users', href: `/tenants/${user.tenant_id}/users`, icon: Users }]
      : []),
    { label: 'Certificates', href: '/certificates', icon: ShieldCheck },
    { label: 'VPN', href: '/vpn', icon: KeyRound },
    { label: 'Alert Rules', href: '/alert-rules', icon: BellRing },
    { label: 'Maintenance', href: '/maintenance', icon: Calendar },
    { label: 'Settings', href: '/settings', icon: Settings },
    { label: 'Audit Log', href: '/audit', icon: ClipboardList },
    { label: 'Reports', href: '/reports', icon: FileBarChart },
  ]

  // ─── Active state ─────────────────────────────────────────────────────

  const isActive = (item: NavItem) => {
    if (item.exact) return currentPath === item.href
    if (item.href === '/settings')
      return currentPath === '/settings' || currentPath.startsWith('/settings/')
    return currentPath.startsWith(item.href) && item.href.length > 1
  }

  // ─── Focus trap for mobile ───────────────────────────────────────────

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

  // ─── Keyboard shortcut: [ to toggle ───────────────────────────────────

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

  // ─── Logout handler ───────────────────────────────────────────────────

  const handleLogout = async () => {
    await logout()
    void navigate({ to: '/login' })
  }

  // ─── Render helpers ───────────────────────────────────────────────────

  const renderNavItem = (item: NavItem, collapsed: boolean) => {
    const Icon = item.icon
    const active = isActive(item)
    return (
      <Link
        key={item.href}
        to={item.href}
        onClick={() => setMobileSidebarOpen(false)}
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={cn(
          collapsed
            ? 'flex items-center justify-center py-[5px] px-2 border-l-2 border-transparent transition-[border-color,color] duration-[50ms] linear hover:border-accent'
            : navItemBase,
          active
            ? navItemActive
            : collapsed
              ? 'text-text-secondary'
              : navItemInactive,
        )}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className={iconClass} aria-hidden="true" />
        {!collapsed && (
          <span className="truncate flex-1">{item.label}</span>
        )}
        {!collapsed && item.badge !== undefined && item.badge > 0 && (
          <span className="text-[8px] font-semibold font-mono bg-alert-badge text-background px-1.5 rounded-sm leading-4">
            {item.badge}
          </span>
        )}
      </Link>
    )
  }

  const renderLowFreqItem = (item: NavItem, collapsed: boolean) => {
    const Icon = item.icon
    const active = isActive(item)
    return (
      <Link
        key={item.href}
        to={item.href}
        onClick={() => setMobileSidebarOpen(false)}
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={cn(
          collapsed
            ? 'flex items-center justify-center py-[3px] px-2 border-l-2 border-transparent transition-[border-color,color] duration-[50ms] linear hover:border-accent'
            : lowFreqBase,
          active && navItemActive,
        )}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className={iconClass} aria-hidden="true" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    )
  }

  // ─── Sidebar content ─────────────────────────────────────────────────

  const sidebarContent = (collapsed: boolean) => (
    <>
      {/* Logo area */}
      <div
        className={cn(
          'flex items-center border-b border-border-subtle px-3 py-2',
          collapsed ? 'justify-center h-12' : 'gap-2 min-h-[48px]',
        )}
      >
        <RugLogo size={collapsed ? 24 : 28} className="flex-shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <span className="text-sm font-semibold text-text-primary">TOD</span>
            <div className="text-[8px] text-text-muted truncate">{tenantName}</div>
          </div>
        )}
      </div>

      {/* Tenant selector (super_admin only) */}
      {superAdmin && !collapsed && tenants && tenants.length > 0 && (
        <div className="px-3 py-2 border-b border-border-subtle">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 w-full text-[11px] text-text-secondary hover:text-text-primary transition-[color] duration-[50ms] linear">
              <span className="truncate flex-1 text-left">{tenantName}</span>
              <ChevronDown className="h-3 w-3 flex-shrink-0 text-text-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4}>
              <DropdownMenuItem
                onClick={() => setSelectedTenantId(null)}
                className="text-xs"
              >
                All Orgs
              </DropdownMenuItem>
              {tenants.map((tenant) => (
                <DropdownMenuItem
                  key={tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                  className="text-xs"
                >
                  {tenant.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {superAdmin && collapsed && (
        <div className="border-b border-border-subtle" />
      )}

      {/* Main navigation */}
      <nav ref={navRef} data-slot="fleet-nav" className="flex-1 overflow-y-auto py-2">
        {/* operate section */}
        {!collapsed && (
          <div className="text-[7px] uppercase tracking-[3px] text-text-label pl-[10px] mb-2">
            operate
          </div>
        )}
        {operateItems.map((item) => renderNavItem(item, collapsed))}

        {/* Hairline separator */}
        <div className="mx-2 my-2 border-t border-border-subtle" />

        {/* act section */}
        {!collapsed && (
          <div className="text-[7px] uppercase tracking-[3px] text-text-label pl-[10px] mb-2">
            act
          </div>
        )}
        {actItems.map((item) => renderNavItem(item, collapsed))}

        {/* Low-frequency items separator */}
        <div className="mx-2 my-2 border-t border-border-subtle" />

        {/* Low-frequency items */}
        {lowFreqItems.map((item) => renderLowFreqItem(item, collapsed))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-subtle px-3 py-2">
        {!collapsed ? (
          <>
            {/* User row: email + theme + logout */}
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[8px] text-text-muted truncate flex-1">
                {user?.email}
              </span>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-0.5 text-text-muted hover:text-text-secondary transition-[color] duration-[50ms] linear"
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? (
                  <Sun className="h-3 w-3" />
                ) : (
                  <Moon className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={() => void handleLogout()}
                className="p-0.5 text-text-muted hover:text-text-secondary transition-[color] duration-[50ms] linear"
                aria-label="Sign out"
              >
                <LogOut className="h-3 w-3" />
              </button>
            </div>
            {/* Scale selector */}
            <div className="flex items-center gap-px rounded-[var(--radius-control)] border border-border-subtle overflow-hidden mb-1">
              {([100, 110, 125] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setUIScale(s)}
                  className={cn(
                    'flex-1 text-[8px] py-px text-center transition-[background-color,color] duration-[50ms]',
                    uiScale === s
                      ? 'bg-accent-soft text-text-primary font-medium'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {s}%
                </button>
              ))}
            </div>
            {/* Connection + version row */}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-[5px] h-[5px] rounded-full flex-shrink-0',
                  connectionState === 'connected' ? 'bg-online' : 'bg-offline',
                  (connectionState === 'connecting' || connectionState === 'reconnecting') && 'animate-pulse',
                )}
                role="status"
                aria-label={`Connection: ${CONNECTION_LABELS[connectionState]}`}
              />
              <span className="text-[8px] text-text-muted">
                {CONNECTION_LABELS[connectionState]}
              </span>
              <span className="text-[8px] text-text-muted font-mono ml-auto">
                {APP_VERSION}
              </span>
            </div>
          </>
        ) : (
          /* Collapsed footer: just connection dot and theme toggle */
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-0.5 text-text-muted hover:text-text-secondary transition-[color] duration-[50ms] linear"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="h-3 w-3" />
              ) : (
                <Moon className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={() => void handleLogout()}
              className="p-0.5 text-text-muted hover:text-text-secondary transition-[color] duration-[50ms] linear"
              aria-label="Sign out"
            >
              <LogOut className="h-3 w-3" />
            </button>
            <span
              className={cn(
                'w-[5px] h-[5px] rounded-full',
                connectionState === 'connected' ? 'bg-online' : 'bg-offline',
                (connectionState === 'connecting' || connectionState === 'reconnecting') && 'animate-pulse',
              )}
              role="status"
              aria-label={`Connection: ${CONNECTION_LABELS[connectionState]}`}
            />
          </div>
        )}
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        data-testid="sidebar"
        data-sidebar
        className={cn(
          'hidden lg:flex flex-col border-r border-border-default bg-sidebar transition-[width] duration-200',
          sidebarCollapsed ? 'w-14' : 'w-[172px]',
        )}
      >
        {sidebarContent(sidebarCollapsed)}
      </aside>

      {/* Mobile hamburger (rendered outside sidebar for AppLayout) */}

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
            className="lg:hidden fixed inset-y-0 left-0 z-50 w-[172px] flex flex-col bg-sidebar border-r border-border-default"
          >
            {sidebarContent(false)}
          </aside>
        </>
      )}
    </>
  )
}
