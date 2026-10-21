import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { renderWithProviders } from '@/test/test-utils'
const state = vi.hoisted(() => ({
  user: { id: 'user-a', tenant_id: 'tenant-a', role: 'tenant_admin' },
  selectedTenantId: 'tenant-b',
  enabled: true,
  config: {} as { component: ComponentType; beforeLoad: () => void },
  fleet: vi.fn(),
  alerts: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: typeof state.config) => {
    state.config = config
    return { useSearch: () => ({ issue: '' }), useNavigate: () => vi.fn() }
  },
  redirect: () => new Error('redirect'),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@/lib/auth', () => ({
  useAuth: (selector: (s: { user: typeof state.user }) => unknown) =>
    selector({ user: state.user }),
}))
vi.mock('@/lib/store', () => ({
  useUIStore: (selector: (s: { selectedTenantId: string | null }) => unknown) =>
    selector({ selectedTenantId: state.selectedTenantId }),
}))
vi.mock('@/lib/features', () => ({
  get operationsPreviewEnabled() {
    return state.enabled
  },
}))
vi.mock('@/lib/api', () => ({ metricsApi: { fleetSummary: state.fleet } }))
vi.mock('@/lib/alertsApi', () => ({ alertsApi: { getAlerts: state.alerts } }))
import '@/routes/_authenticated/operations'

describe('Operations query boundaries', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    state.enabled = true
    state.user = { id: 'user-a', tenant_id: 'tenant-a', role: 'tenant_admin' }
    state.selectedTenantId = 'tenant-b'
    state.fleet.mockResolvedValue([])
    state.alerts.mockResolvedValue({ items: [], total: 0 })
  })
  it('blocks the route when the build flag is disabled', () => {
    state.enabled = false
    expect(() => state.config.beforeLoad()).toThrow('redirect')
  })
  it('uses the authenticated tenant instead of a persisted organization choice', async () => {
    const Page = state.config.component
    renderWithProviders(<Page />)
    await waitFor(() => expect(state.fleet).toHaveBeenCalledWith('tenant-a'))
    expect(state.alerts).toHaveBeenCalledWith('tenant-a', { status: 'flapping', per_page: 200 })
    expect(state.fleet).not.toHaveBeenCalledWith('tenant-b')
  })
  it('changes organization without displaying the previous organization evidence', async () => {
    state.user.role = 'super_admin'
    state.fleet.mockResolvedValue([
      { id: 'private-b', hostname: 'Organization B router', status: 'offline', last_seen: null },
    ])
    const Page = state.config.component
    const view = renderWithProviders(<Page />)
    await screen.findAllByText('Organization B router')
    state.selectedTenantId = 'tenant-c'
    state.fleet.mockImplementation(() => new Promise(() => {}))
    view.rerender(<Page />)
    expect(screen.queryByText('Organization B router')).not.toBeInTheDocument()
    await waitFor(() => expect(state.fleet).toHaveBeenCalledWith('tenant-c'))
  })
  it('does not declare health when alert coverage is truncated', async () => {
    state.alerts.mockResolvedValue({ items: [], total: 201 })
    const Page = state.config.component
    renderWithProviders(<Page />)
    expect(await screen.findByText('Monitoring is incomplete')).toBeInTheDocument()
    expect(screen.getByText(/Only the first 200/)).toBeInTheDocument()
  })
  it('does not declare health when the alert endpoint fails', async () => {
    state.alerts.mockRejectedValue(new Error('fetch failed'))
    const Page = state.config.component
    renderWithProviders(<Page />)
    expect(await screen.findByText('Monitoring is incomplete')).toBeInTheDocument()
    expect(screen.getByText('Alert evidence could not be refreshed.')).toBeInTheDocument()
  })
  it('shows available fleet evidence while alert evidence is still loading', async () => {
    state.fleet.mockResolvedValue([
      { id: 'available', hostname: 'Available router', status: 'offline', last_seen: null },
    ])
    state.alerts.mockImplementation(() => new Promise(() => {}))
    const Page = state.config.component
    renderWithProviders(<Page />)
    expect(
      await screen.findByRole('button', { name: /Reported offline.*Available router/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('Alert evidence is still loading.')).toBeInTheDocument()
    expect(screen.getByText('Monitoring is incomplete')).toBeInTheDocument()
  })
})
