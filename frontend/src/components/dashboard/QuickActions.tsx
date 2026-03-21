import { Link } from '@tanstack/react-router'
import {
  Plus,
  HardDrive,
  RefreshCw,
  FileCode,
  Bell,
  Map,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface QuickActionsProps {
  tenantId: string
  isSuperAdmin: boolean
}

interface ActionItem {
  label: string
  icon: React.ReactNode
  to: string
  description: string
}

function getActions(tenantId: string, isSuperAdmin: boolean): ActionItem[] {
  // For super_admin without a specific tenant, routes go to tenant list or top-level pages
  const deviceBase = isSuperAdmin
    ? '/tenants'
    : `/tenants/${tenantId}/devices`

  return [
    {
      label: 'Add Device',
      icon: <Plus className="h-5 w-5" />,
      to: isSuperAdmin ? '/tenants' : `/tenants/${tenantId}/devices/add`,
      description: isSuperAdmin ? 'Select an organization first' : 'Register a new device',
    },
    {
      label: 'Trigger Backup',
      icon: <HardDrive className="h-5 w-5" />,
      to: deviceBase,
      description: 'Back up device configs',
    },
    {
      label: 'Check Firmware',
      icon: <RefreshCw className="h-5 w-5" />,
      to: '/firmware',
      description: 'Review firmware versions',
    },
    {
      label: 'Push Template',
      icon: <FileCode className="h-5 w-5" />,
      to: '/templates',
      description: 'Deploy config templates',
    },
    {
      label: 'View Alerts',
      icon: <Bell className="h-5 w-5" />,
      to: '/alerts',
      description: 'Active alert events',
    },
    {
      label: 'Open Map',
      icon: <Map className="h-5 w-5" />,
      to: '/map',
      description: 'Device locations',
    },
  ]
}

export function QuickActions({ tenantId, isSuperAdmin }: QuickActionsProps) {
  const actions = getActions(tenantId, isSuperAdmin)

  return (
    <div className="bg-panel border border-border rounded-sm">
      <div className="px-3 py-2 border-b border-border-subtle bg-elevated">
        <span className="text-[7px] font-medium text-text-muted uppercase tracking-[1.5px]">
          Quick Actions
        </span>
      </div>
      <div className="divide-y divide-border-subtle">
        {actions.map((action) => (
          <Link
            key={action.label}
            to={action.to}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2',
              'text-text-secondary hover:text-text-primary',
              'border-l-2 border-transparent hover:border-accent',
              'transition-[border-color,color] duration-[50ms]',
            )}
          >
            <div className="text-text-muted">
              {action.icon}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-medium block">
                {action.label}
              </span>
              <span className="text-[10px] text-text-muted block">
                {action.description}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
