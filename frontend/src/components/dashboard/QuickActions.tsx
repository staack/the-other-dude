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
    <Card className="bg-panel border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-text-secondary">
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <Link
              key={action.label}
              to={action.to}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg px-3 py-3',
                'text-text-secondary hover:bg-elevated/50 hover:text-text-primary',
                'transition-colors text-center',
              )}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-elevated/50">
                {action.icon}
              </div>
              <span className="text-xs font-medium leading-tight">
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
