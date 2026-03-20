import { useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { ChevronDown, Sun, Moon, LogOut, Settings, Menu } from 'lucide-react'
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
import { tenantsApi, metricsApi } from '@/lib/api'
import { getLicenseStatus } from '@/lib/settingsApi'
import { useEventStreamContext } from '@/contexts/EventStreamContext'
import type { ConnectionState } from '@/hooks/useEventStream'
import { NotificationBell } from '@/components/alerts/NotificationBell'

const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning animate-pulse',
  reconnecting: 'bg-warning animate-pulse',
  disconnected: 'bg-error',
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
}

// Generate a deterministic color from a string
function tenantColor(name: string): string {
  const colors = [
    'bg-info', 'bg-success', 'bg-accent', 'bg-warning',
    'bg-error', 'bg-info', 'bg-accent', 'bg-success',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function ContextStrip() {
  const { user, logout } = useAuth()
  const { selectedTenantId, setSelectedTenantId, theme, setTheme, setMobileSidebarOpen } = useUIStore()
  const { connectionState } = useEventStreamContext()
  const navigate = useNavigate()
  const superAdmin = isSuperAdmin(user)

  // Tenant list (super_admin only)
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

  // Fleet summary for status indicators
  const tenantId = superAdmin ? selectedTenantId : user?.tenant_id
  const { data: fleet } = useQuery({
    queryKey: ['fleet-summary', superAdmin ? 'all' : tenantId],
    queryFn: () =>
      superAdmin && !selectedTenantId
        ? metricsApi.fleetSummaryAll()
        : tenantId
          ? metricsApi.fleetSummary(tenantId)
          : Promise.resolve([]),
    enabled: !!tenantId || superAdmin,
    refetchInterval: 30_000,
  })

  const offlineCount = fleet?.filter((d) => d.status === 'offline').length ?? 0
  const degradedCount = fleet?.filter((d) => d.status === 'degraded').length ?? 0

  // License status (super_admin only)
  const { data: license } = useQuery({
    queryKey: ['license-status'],
    queryFn: getLicenseStatus,
    enabled: superAdmin,
    refetchInterval: 60_000,
  })

  const handleLogout = async () => {
    await logout()
    void navigate({ to: '/login' })
  }

  // User initials for avatar
  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? '?'

  // Tenant display name for non-super_admin
  const tenantName = superAdmin
    ? (selectedTenant?.name ?? 'All Orgs')
    : user?.name ?? 'Tenant'

  return (
    <div className="flex items-center h-9 bg-background/80 border-b border-border px-4 gap-4 flex-shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileSidebarOpen(true)}
        className="lg:hidden p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-elevated transition-colors -ml-1"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Left: Org switcher */}
      <div className="flex items-center border-r border-border pr-4">
        {superAdmin && tenants && tenants.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors">
              <div
                className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold text-white ${tenantColor(tenantName)}`}
              >
                {tenantName[0]?.toUpperCase()}
              </div>
              <span className="truncate max-w-[120px]">{tenantName}</span>
              <ChevronDown className="h-3 w-3 flex-shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-xs">Organization</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSelectedTenantId(null)} className="text-xs">
                All Orgs
              </DropdownMenuItem>
              {tenants.map((tenant) => (
                <DropdownMenuItem
                  key={tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                  className="text-xs"
                >
                  <div
                    className={`w-3 h-3 rounded flex items-center justify-center text-[7px] font-bold text-white mr-1.5 ${tenantColor(tenant.name)}`}
                  >
                    {tenant.name[0]?.toUpperCase()}
                  </div>
                  {tenant.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="text-xs text-text-secondary truncate max-w-[120px]">
            {superAdmin ? 'No orgs' : (user?.name ?? 'Tenant')}
          </span>
        )}
      </div>

      {/* Center: Status indicators */}
      <div className="flex-1 hidden sm:flex items-center gap-3">
        {fleet ? (
          <>
            {offlineCount > 0 && (
              <button
                onClick={() => void navigate({ to: '/' })}
                className="flex items-center gap-1 text-xs text-error hover:text-error/80 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-error" />
                {offlineCount} down
              </button>
            )}
            {degradedCount > 0 && (
              <button
                onClick={() => void navigate({ to: '/' })}
                className="flex items-center gap-1 text-xs text-warning hover:text-warning/80 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                {degradedCount} degraded
              </button>
            )}
            {offlineCount === 0 && degradedCount === 0 && fleet.length > 0 && (
              <span className="text-xs text-text-muted">All systems nominal</span>
            )}
            {fleet.length === 0 && (
              <span className="text-xs text-text-muted">No devices</span>
            )}
          </>
        ) : (
          <span className="text-xs text-text-muted">Status loading...</span>
        )}
        {license?.over_limit && (
          <span className="text-xs font-mono text-error animate-pulse">
            {license.actual_devices}/{license.licensed_devices} licensed
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Notification bell */}
        {tenantId && <NotificationBell tenantId={tenantId} />}

        {/* Command palette shortcut */}
        <button
          onClick={() => useCommandPalette.getState().setOpen(true)}
          className="text-[10px] font-mono text-text-muted hover:text-text-secondary border border-border rounded px-1.5 py-0.5 transition-colors"
          aria-label="Open command palette"
        >
          &#8984;K
        </button>

        {/* Connection status dot */}
        <div
          className={`w-1.5 h-1.5 rounded-full ${CONNECTION_COLORS[connectionState]}`}
          role="status"
          aria-label={`Connection: ${CONNECTION_LABELS[connectionState]}`}
          title={CONNECTION_LABELS[connectionState]}
        />

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center" aria-label="User menu">
            <div className="w-[22px] h-[22px] rounded-full bg-elevated flex items-center justify-center text-[9px] font-semibold text-text-secondary">
              {initials}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="text-xs font-normal text-text-secondary">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="flex items-center gap-2 text-xs">
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleLogout()} className="text-error text-xs">
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
