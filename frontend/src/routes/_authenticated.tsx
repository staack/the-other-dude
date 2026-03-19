import { useCallback } from 'react'
import { createFileRoute, Outlet, Navigate, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useUIStore } from '@/lib/store'
import { useEventStream, type SSEEvent } from '@/hooks/useEventStream'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSequenceShortcut } from '@/hooks/useShortcut'
import { EventStreamProvider } from '@/contexts/EventStreamContext'
import type { FleetDevice } from '@/lib/api'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTransition } from '@/components/layout/PageTransition'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBoundary } from '@/components/ui/error-boundary'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: () => {
    const { isAuthenticated } = useAuth.getState()
    if (!isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { isAuthenticated, isLoading, user } = useAuth()
  const routerState = useRouterState()
  const pageKey = routerState.location.pathname
  const queryClient = useQueryClient()
  const nav = useNavigate()

  usePageTitle()

  const isSuperAdmin = user?.role === 'super_admin'
  const selectedTenantId = useUIStore((s) => s.selectedTenantId)

  // For regular users, use their tenant_id. For super_admin, use selectedTenantId.
  const effectiveTenantId = isSuperAdmin ? selectedTenantId : (user?.tenant_id ?? null)

  // Fleet summary query key must match FleetDashboard exactly
  const fleetSummaryKey = ['fleet-summary', isSuperAdmin ? 'all' : (effectiveTenantId ?? '')]

  const onEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        // ── Device status changes (RT-02) ─────────────────────────────────
        case 'device_status': {
          const { device_id, status, device_name } = event.data as {
            device_id: string
            status: string
            device_name?: string
          }
          // Optimistic update in fleet summary cache
          queryClient.setQueryData<FleetDevice[]>(fleetSummaryKey, (old) => {
            if (!old) return old
            return old.map((d) =>
              d.id === device_id
                ? { ...d, status, last_seen: new Date().toISOString() }
                : d,
            )
          })
          // Invalidate device detail queries
          void queryClient.invalidateQueries({ queryKey: ['device', device_id] })
          // Invalidate fleet-devices keys used by other components
          void queryClient.invalidateQueries({ queryKey: ['fleet-devices'] })
          void (() => device_name)() // suppress unused lint (used only in data payload)
          break
        }

        // ── Alert fired (RT-03) ───────────────────────────────────────────
        case 'alert_fired': {
          const { severity, rule_name, device_name, metric, current_value, threshold } =
            event.data as {
              severity: string
              rule_name: string
              device_name?: string
              metric?: string
              current_value?: string | number
              threshold?: string | number
            }
          const toastFn =
            severity === 'critical'
              ? toast.error
              : severity === 'warning'
                ? toast.warning
                : toast.info
          toastFn(`Alert: ${rule_name}`, {
            description: device_name
              ? `${device_name} — ${metric ?? 'unknown'}: ${current_value ?? '?'} (threshold: ${threshold ?? '?'})`
              : `${metric ?? 'unknown'}: ${current_value ?? '?'}`,
            duration: severity === 'critical' ? 10000 : 5000,
          })
          void queryClient.invalidateQueries({ queryKey: ['active-alerts'] })
          void queryClient.invalidateQueries({ queryKey: ['alert-events'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard-alerts'] })
          break
        }

        // ── Alert resolved ────────────────────────────────────────────────
        case 'alert_resolved': {
          const { metric } = event.data as {
            device_id?: string
            metric?: string
          }
          toast.info('Alert resolved', {
            description: `${metric ?? 'Condition'} returned to normal`,
            duration: 3000,
          })
          void queryClient.invalidateQueries({ queryKey: ['active-alerts'] })
          void queryClient.invalidateQueries({ queryKey: ['alert-events'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard-alerts'] })
          break
        }

        // ── Config push progress (RT-04) ──────────────────────────────────
        case 'config_push': {
          const { device_id, stage, message } = event.data as {
            device_id: string
            stage: string
            message?: string
          }
          window.dispatchEvent(
            new CustomEvent('config-push-progress', {
              detail: { device_id, stage, message },
            }),
          )
          // On terminal states, invalidate config backup queries
          if (['committed', 'reverted', 'failed'].includes(stage)) {
            void queryClient.invalidateQueries({
              queryKey: ['config-backups', device_id],
            })
          }
          break
        }

        // ── Firmware upgrade progress (RT-05) ─────────────────────────────
        case 'firmware_progress': {
          const { job_id, device_id, stage, message, target_version } = event.data as {
            job_id?: string
            device_id?: string
            stage: string
            message?: string
            target_version?: string
          }
          window.dispatchEvent(
            new CustomEvent('firmware-progress', {
              detail: { job_id, device_id, stage, message, target_version },
            }),
          )
          // Invalidate firmware job queries so polling-based components also update
          if (job_id) {
            void queryClient.invalidateQueries({
              queryKey: ['upgrade-job'],
            })
          }
          if (['completed', 'failed'].includes(stage)) {
            void queryClient.invalidateQueries({ queryKey: ['firmware-overview'] })
            void queryClient.invalidateQueries({ queryKey: ['upgrade-jobs'] })
          }
          break
        }

        // ── Metric updates ────────────────────────────────────────────────
        case 'metric_update': {
          void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
          void queryClient.invalidateQueries({ queryKey: ['fleet-devices'] })
          break
        }
      }
    },
    [queryClient, fleetSummaryKey],
  )

  // Only connect SSE when authenticated and we have a tenant context
  const sseEnabled = isAuthenticated && !isLoading
  const { connectionState, lastConnectedAt, reconnect } = useEventStream(
    sseEnabled ? effectiveTenantId : null,
    onEvent,
  )

  // ── Global navigation shortcuts (g + key) ──────────────────────────────────
  const shortcutsEnabled = isAuthenticated && !isLoading
  useSequenceShortcut(['g', 'd'], () => void nav({ to: '/' }), shortcutsEnabled)
  useSequenceShortcut(['g', 'a'], () => void nav({ to: '/alerts' }), shortcutsEnabled)
  useSequenceShortcut(['g', 't'], () => void nav({ to: '/topology' }), shortcutsEnabled)
  useSequenceShortcut(['g', 'f'], () => void nav({ to: '/firmware' }), shortcutsEnabled)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  // Hide sidebar/header during setup wizard for a focused experience
  const isSetup = pageKey === '/setup'

  return (
    <EventStreamProvider
      connectionState={connectionState}
      lastConnectedAt={lastConnectedAt}
      reconnect={reconnect}
    >
      <ErrorBoundary>
        {isSetup ? (
          <Outlet />
        ) : (
          <AppLayout data-app-scope="fleet">
            <AnimatePresence mode="wait">
              <PageTransition pageKey={pageKey}>
                <Outlet />
              </PageTransition>
            </AnimatePresence>
          </AppLayout>
        )}
      </ErrorBoundary>
    </EventStreamProvider>
  )
}
