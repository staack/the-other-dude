import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

interface DeviceLinkProps {
  tenantId: string
  deviceId: string
  children: React.ReactNode
  className?: string
}

export function DeviceLink({ tenantId, deviceId, children, className }: DeviceLinkProps) {
  return (
    <Link
      to="/tenants/$tenantId/devices/$deviceId"
      params={{ tenantId, deviceId }}
      className={cn('hover:text-text-primary hover:underline', className)}
    >
      {children}
    </Link>
  )
}
