import { createFileRoute } from '@tanstack/react-router'
import { TenantList } from '@/components/tenants/TenantList'

export const Route = createFileRoute('/_authenticated/tenants/')({
  component: TenantsPage,
})

function TenantsPage() {
  return <TenantList />
}
