// DEPRECATED: Replaced by ContextStrip.tsx — keeping for reference during transition
import { useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { LogOut, ChevronDown, User, Search, Sun, Moon, RefreshCw, Menu, Settings } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useCommandPalette } from '@/components/command-palette/useCommandPalette'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth, isSuperAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { tenantsApi } from '@/lib/api'
import { useEventStreamContext } from '@/contexts/EventStreamContext'
import type { ConnectionState } from '@/hooks/useEventStream'

// ─── Connection State Indicator ──────────────────────────────────────────────

const CONNECTION_CONFIG: Record<
  ConnectionState,
  { colorClass: string; label: string; pulse: boolean }
> = {
  connected: { colorClass: 'bg-success', label: 'Connected', pulse: false },
  connecting: { colorClass: 'bg-warning', label: 'Connecting...', pulse: true },
  reconnecting: { colorClass: 'bg-warning', label: 'Reconnecting...', pulse: true },
  disconnected: { colorClass: 'bg-error', label: 'Disconnected', pulse: false },
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function ConnectionIndicator({
  state,
  lastConnectedAt,
  onReconnect,
}: {
  state: ConnectionState
  lastConnectedAt: Date | null
  onReconnect: () => void
}) {
  const { colorClass, label, pulse } = CONNECTION_CONFIG[state]

  return (
    <div className="relative group flex items-center">
      <div
        className={`h-2 w-2 rounded-full ${colorClass} ${pulse ? 'animate-pulse' : ''}`}
        role="status"
        aria-label={`Real-time connection: ${label}`}
      />
      {/* Tooltip on hover */}
      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-50">
        <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap">
          <p className="font-medium text-text-primary">{label}</p>
          {lastConnectedAt && (
            <p className="text-text-muted mt-0.5">
              Last connected: {formatTime(lastConnectedAt)}
            </p>
          )}
          {state === 'disconnected' && (
            <button
              onClick={onReconnect}
              className="flex items-center gap-1 mt-1.5 text-accent hover:text-accent-hover transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

export function Header() {
  const { user, logout } = useAuth()
  const { selectedTenantId, setSelectedTenantId, theme, setTheme } = useUIStore()
  const { connectionState, lastConnectedAt, reconnect } = useEventStreamContext()
  const navigate = useNavigate()

  const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    enabled: isSuperAdmin(user),
    select: (data) => data.filter((t) => t.id !== SYSTEM_TENANT_ID),
  })

  const selectedTenant = tenants?.find((t) => t.id === selectedTenantId)

  // Auto-select when there's exactly one tenant and nothing selected
  useEffect(() => {
    if (isSuperAdmin(user) && tenants && tenants.length === 1 && !selectedTenantId) {
      setSelectedTenantId(tenants[0].id)
    }
  }, [tenants, selectedTenantId, user, setSelectedTenantId])

  const handleLogout = async () => {
    await logout()
    void navigate({ to: '/login' })
  }

  const roleLabel: Record<string, string> = {
    super_admin: 'Super Admin',
    tenant_admin: 'Admin',
    operator: 'Operator',
    viewer: 'Viewer',
  }

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-sidebar flex-shrink-0" data-testid="header">
      {/* Left: hamburger + tenant context */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => useUIStore.getState().setMobileSidebarOpen(true)}
          className="lg:hidden p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        {isSuperAdmin(user) && tenants && tenants.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors" data-testid="header-org-selector">
              <span>{selectedTenant ? selectedTenant.name : 'All Organizations'}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Organization Context</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSelectedTenantId(null)}>
                All Organizations
              </DropdownMenuItem>
              {tenants.map((tenant) => (
                <DropdownMenuItem
                  key={tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                >
                  {tenant.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Right: actions + user menu */}
      <div className="flex items-center gap-2">
        {/* Search trigger */}
        <button
          onClick={() => useCommandPalette.getState().setOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-text-muted text-sm hover:text-text-secondary hover:border-border-bright transition-colors"
          aria-label="Search (Cmd+K)"
          data-testid="header-search"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Search...</span>
          <kbd className="hidden lg:inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-mono text-text-muted">
            Cmd+K
          </kbd>
        </button>

        {/* Dark/light mode toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          data-testid="header-theme-toggle"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* SSE connection state indicator */}
        <ConnectionIndicator
          state={connectionState}
          lastConnectedAt={lastConnectedAt}
          onReconnect={reconnect}
        />

      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors" aria-label="User menu" data-testid="header-user-menu">
          <div className="w-6 h-6 rounded-full bg-elevated flex items-center justify-center">
            <User className="h-3.5 w-3.5" />
          </div>
          <span className="hidden lg:block">{user?.name ?? user?.email}</span>
          {/* Only show role if it differs from the display name */}
          {(user?.name ?? user?.email) !== (roleLabel[user?.role ?? ''] ?? user?.role) && (
            <span className="hidden lg:block text-xs text-text-muted">
              {roleLabel[user?.role ?? ''] ?? user?.role}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <div className="font-normal text-text-secondary text-xs">{user?.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void handleLogout()} className="text-error" data-testid="button-sign-out">
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  )
}
