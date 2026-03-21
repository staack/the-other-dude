import { useEffect, useMemo } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Monitor,
  MapPin,
  Terminal,
  FileCode,
  Download,
  Bell,
  BellRing,
  Users,
  Building2,
  Settings,
  Search,
  LayoutDashboard,
  Moon,
  Sun,
  PanelLeft,
} from 'lucide-react'
import { useCommandPalette } from './useCommandPalette'
import { useAuth, isSuperAdmin, isTenantAdmin } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import type { DeviceListResponse } from '@/lib/api'

interface PageCommand {
  label: string
  href: string
  icon: React.FC<{ className?: string }>
  description?: string
  visible: boolean
}

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { theme, setTheme, toggleSidebar } = useUIStore()
  const queryClient = useQueryClient()

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, setOpen])

  const tenantDevicesHref = isSuperAdmin(user)
    ? '/tenants'
    : `/tenants/${user?.tenant_id ?? ''}/devices`

  // Build page commands based on user role
  const pageCommands: PageCommand[] = useMemo(
    () => [
      {
        label: 'Dashboard',
        href: tenantDevicesHref,
        icon: LayoutDashboard,
        description: 'Fleet overview',
        visible: true,
      },
      {
        label: 'Devices',
        href: tenantDevicesHref,
        icon: Monitor,
        description: 'Device list',
        visible: true,
      },
      {
        label: 'Map',
        href: '/map',
        icon: MapPin,
        description: 'Network map',
        visible: true,
      },
      {
        label: 'Config Editor',
        href: '/config-editor',
        icon: Terminal,
        description: 'Device configuration',
        visible: true,
      },
      {
        label: 'Templates',
        href: '/templates',
        icon: FileCode,
        description: 'Config templates',
        visible: true,
      },
      {
        label: 'Firmware',
        href: '/firmware',
        icon: Download,
        description: 'Firmware management',
        visible: true,
      },
      {
        label: 'Alerts',
        href: '/alerts',
        icon: Bell,
        description: 'Active alerts',
        visible: true,
      },
      {
        label: 'Alert Rules',
        href: '/alert-rules',
        icon: BellRing,
        description: 'Alert rule configuration',
        visible: true,
      },
      {
        label: 'Users',
        href: `/tenants/${user?.tenant_id ?? ''}/users`,
        icon: Users,
        description: 'User management',
        visible: isTenantAdmin(user) && !!user?.tenant_id,
      },
      {
        label: 'Organizations',
        href: '/tenants',
        icon: Building2,
        description: 'Organization management',
        visible: isSuperAdmin(user) || isTenantAdmin(user),
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        description: 'Application settings',
        visible: true,
      },
    ],
    [user, tenantDevicesHref],
  )

  // Get cached devices from TanStack Query (try common query key patterns)
  const devicesCache = useMemo(() => {
    // Try to find devices data in the query cache
    const allQueries = queryClient.getQueriesData<DeviceListResponse>({
      queryKey: ['devices'],
    })
    const devices: Array<{
      id: string
      hostname: string
      ip_address: string
      tenant_id: string
    }> = []

    for (const [, data] of allQueries) {
      if (data && 'items' in data && Array.isArray(data.items)) {
        for (const device of data.items) {
          devices.push({
            id: device.id,
            hostname: device.hostname,
            ip_address: device.ip_address,
            tenant_id: user?.tenant_id ?? '',
          })
        }
      }
    }

    // Also try fleet summary cache
    const fleetQueries = queryClient.getQueriesData<
      Array<{
        id: string
        hostname: string
        ip_address: string
        tenant_id: string
      }>
    >({ queryKey: ['fleet'] })
    for (const [, data] of fleetQueries) {
      if (Array.isArray(data)) {
        for (const device of data) {
          if (
            device.id &&
            device.hostname &&
            !devices.some((d) => d.id === device.id)
          ) {
            devices.push({
              id: device.id,
              hostname: device.hostname,
              ip_address: device.ip_address,
              tenant_id: device.tenant_id ?? user?.tenant_id ?? '',
            })
          }
        }
      }
    }

    return devices
  }, [queryClient, user?.tenant_id, open])

  const handleSelect = (href: string) => {
    setOpen(false)
    void navigate({ to: href })
  }

  const visiblePages = pageCommands.filter((p) => p.visible)

  const itemClass =
    'flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-text-secondary cursor-pointer data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent'
  const groupHeadingClass =
    '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider'

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Menu"
      overlayClassName="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[20%] -translate-x-1/2 z-50 w-full max-w-lg"
    >
      <div className="rounded-lg border border-border bg-panel overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search className="h-4 w-4 text-text-muted flex-shrink-0" />
          <Command.Input
            placeholder="Search pages, devices, actions..."
            className="w-full py-3 text-sm bg-transparent text-text-primary placeholder:text-text-muted outline-none"
          />
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
            No results found.
          </Command.Empty>

          {/* Pages group */}
          <Command.Group heading="Pages" className={groupHeadingClass}>
            {visiblePages.map((page) => {
              const Icon = page.icon
              return (
                <Command.Item
                  key={page.label}
                  value={`${page.label} ${page.description ?? ''}`}
                  onSelect={() => handleSelect(page.href)}
                  className={itemClass}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span>{page.label}</span>
                  {page.description && (
                    <span className="ml-auto text-xs text-text-muted">
                      {page.description}
                    </span>
                  )}
                </Command.Item>
              )
            })}
          </Command.Group>

          {/* Devices group (from cache) */}
          {devicesCache.length > 0 && (
            <Command.Group heading="Devices" className={groupHeadingClass}>
              {devicesCache.slice(0, 20).map((device) => (
                <Command.Item
                  key={device.id}
                  value={`${device.hostname} ${device.ip_address}`}
                  onSelect={() =>
                    handleSelect(
                      `/tenants/${device.tenant_id}/devices`,
                    )
                  }
                  className={itemClass}
                >
                  <Monitor className="h-4 w-4 flex-shrink-0" />
                  <span>{device.hostname}</span>
                  <span className="ml-auto text-xs text-text-muted font-mono">
                    {device.ip_address}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {/* Actions group */}
          <Command.Group heading="Actions" className={groupHeadingClass}>
            <Command.Item
              value="toggle dark light mode theme"
              onSelect={() => {
                setTheme(theme === 'dark' ? 'light' : 'dark')
                setOpen(false)
              }}
              className={itemClass}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 flex-shrink-0" />
              ) : (
                <Moon className="h-4 w-4 flex-shrink-0" />
              )}
              <span>
                Toggle {theme === 'dark' ? 'Light' : 'Dark'} Mode
              </span>
            </Command.Item>
            <Command.Item
              value="toggle sidebar collapse expand"
              onSelect={() => {
                toggleSidebar()
                setOpen(false)
              }}
              className={itemClass}
            >
              <PanelLeft className="h-4 w-4 flex-shrink-0" />
              <span>Toggle Sidebar</span>
            </Command.Item>
          </Command.Group>
        </Command.List>

        {/* Footer with shortcut hints */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-text-muted">
          <span>Navigate with arrow keys</span>
          <span>Open with Cmd+K</span>
        </div>
      </div>
    </Command.Dialog>
  )
}
