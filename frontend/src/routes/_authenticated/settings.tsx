import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router'
import { SettingsPage } from '@/components/settings/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const matches = useMatches()
  // If we're on a child route (credentials, snmp-profiles, api-keys), render the Outlet.
  // If we're on the exact /settings route, render the SettingsPage index.
  const isChildRoute = matches.some(
    (m) => m.routeId !== '/_authenticated/settings' && m.routeId.startsWith('/_authenticated/settings/')
  )

  if (isChildRoute) {
    return <Outlet />
  }

  return <SettingsPage />
}
