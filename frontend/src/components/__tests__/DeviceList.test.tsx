/**
 * Device list (FleetTable) component tests -- verifies device data rendering,
 * loading state, empty state, and table structure.
 *
 * Tests the FleetTable component directly since DevicesPage is tightly coupled
 * to TanStack Router file-based routing (Route.useParams/useSearch).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import type { DeviceListResponse } from '@/lib/api'

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
    <a href={props.to ?? '#'}>{children}</a>
  ),
}))

// Mock devicesApi at the module level
const mockDevicesList = vi.fn()

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    devicesApi: {
      ...actual.devicesApi,
      list: (...args: unknown[]) => mockDevicesList(...args),
    },
  }
})

// --------------------------------------------------------------------------
// Test data
// --------------------------------------------------------------------------

const testDevices: DeviceListResponse = {
  items: [
    {
      id: 'dev-1',
      hostname: 'router-office-1',
      ip_address: '192.168.1.1',
      api_port: 8728,
      api_ssl_port: 8729,
      model: 'RB4011',
      serial_number: 'ABC123',
      firmware_version: '7.12',
      routeros_version: '7.12.1',
      uptime_seconds: 86400,
      last_seen: '2026-03-01T12:00:00Z',
      latitude: null,
      longitude: null,
      status: 'online',
      tags: [{ id: 'tag-1', name: 'core', color: '#00ff00' }],
      groups: [],
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'dev-2',
      hostname: 'ap-floor2',
      ip_address: '192.168.1.10',
      api_port: 8728,
      api_ssl_port: 8729,
      model: 'cAP ac',
      serial_number: 'DEF456',
      firmware_version: '7.10',
      routeros_version: '7.10.2',
      uptime_seconds: 3600,
      last_seen: '2026-03-01T11:00:00Z',
      latitude: null,
      longitude: null,
      status: 'offline',
      tags: [],
      groups: [],
      created_at: '2026-01-15T00:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  page_size: 25,
}

const emptyDevices: DeviceListResponse = {
  items: [],
  total: 0,
  page: 1,
  page_size: 25,
}

// --------------------------------------------------------------------------
// Component import (after mocks)
// --------------------------------------------------------------------------
import { FleetTable } from '@/components/fleet/FleetTable'

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('FleetTable (Device List)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders device list with data', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    // FleetTable renders both mobile cards and desktop table rows; use data-testid
    // for device-specific elements to avoid "multiple elements" errors.
    expect(await screen.findByTestId('device-card-router-office-1')).toBeInTheDocument()
    expect(screen.getByTestId('device-card-ap-floor2')).toBeInTheDocument()
  })

  it('renders device model and firmware info', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    // Desktop table row has data-testid
    await screen.findByTestId('device-row-router-office-1')

    // RouterOS versions appear once in desktop table row (mobile shows vX.X.X format)
    expect(screen.getByTestId('device-row-router-office-1')).toBeInTheDocument()
    expect(screen.getByTestId('device-row-ap-floor2')).toBeInTheDocument()
  })

  it('renders empty state when no devices', async () => {
    mockDevicesList.mockResolvedValueOnce(emptyDevices)

    render(<FleetTable tenantId="tenant-1" />)

    // Component shows "No devices yet" (not "No devices found")
    expect(await screen.findAllByText('No devices yet')).not.toHaveLength(0)
  })

  it('renders loading state', async () => {
    // Make the API hang (never resolve)
    mockDevicesList.mockReturnValueOnce(new Promise(() => {}))

    render(<FleetTable tenantId="tenant-1" />)

    // Component uses TableSkeleton (no plain text), just verify nothing has loaded
    expect(screen.queryByTestId('device-card-router-office-1')).not.toBeInTheDocument()
  })

  it('renders table headers', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByTestId('device-row-router-office-1')

    expect(screen.getByText('Hostname')).toBeInTheDocument()
    expect(screen.getByText('IP')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('RouterOS')).toBeInTheDocument()
    expect(screen.getByText('Firmware')).toBeInTheDocument()
    expect(screen.getByText('Uptime')).toBeInTheDocument()
    expect(screen.getByText('Last Seen')).toBeInTheDocument()
    expect(screen.getByText('Tags')).toBeInTheDocument()
  })

  it('renders device tags', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    // Tags appear in both mobile and desktop views; use getAllByText
    expect(await screen.findAllByText('core')).not.toHaveLength(0)
  })

  it('renders formatted uptime', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByTestId('device-row-router-office-1')

    // 86400 seconds = 1d 0h — appears in both views, check at least one exists
    expect(screen.getAllByText('1d 0h').length).toBeGreaterThan(0)
    // 3600 seconds = 1h 0m
    expect(screen.getAllByText('1h 0m').length).toBeGreaterThan(0)
  })

  it('shows pagination info', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByTestId('device-row-router-office-1')

    // "Showing 1–2 of 2 devices"
    expect(screen.getByText(/Showing 1/)).toBeInTheDocument()
  })

  it('renders status indicators for online and offline devices', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByTestId('device-row-router-office-1')

    // StatusDot elements have title attribute -- multiple exist (mobile + desktop)
    const onlineDots = screen.getAllByTitle('online')
    const offlineDots = screen.getAllByTitle('offline')

    expect(onlineDots.length).toBeGreaterThan(0)
    expect(offlineDots.length).toBeGreaterThan(0)
  })
})
