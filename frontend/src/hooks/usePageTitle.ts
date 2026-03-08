import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/alerts': 'Alerts',
  '/alert-rules': 'Alert Rules',
  '/audit': 'Audit Log',
  '/batch-config': 'Batch Config',
  '/bulk-commands': 'Bulk Commands',
  '/certificates': 'Certificates',
  '/config-editor': 'Config Editor',
  '/firmware': 'Firmware',
  '/maintenance': 'Maintenance',
  '/map': 'Map',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/settings/api-keys': 'API Keys',
  '/setup': 'Setup',
  '/templates': 'Templates',
  '/tenants': 'Organizations',
  '/topology': 'Topology',
  '/transparency': 'Transparency',
  '/vpn': 'VPN',

  '/about': 'About',
}

export function usePageTitle() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    // Match exact path or fall back to first segment
    let title = ROUTE_TITLES[pathname]

    if (!title) {
      // Handle device-specific routes like /devices/:id/...
      if (pathname.startsWith('/devices/')) {
        title = 'Device'
      } else {
        // Capitalize the first path segment
        const segment = pathname.split('/').filter(Boolean)[0]
        title = segment
          ? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
          : 'Dashboard'
      }
    }

    document.title = `${title} | TOD`
  }, [pathname])
}
