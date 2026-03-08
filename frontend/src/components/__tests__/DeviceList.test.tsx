/**
 * Device list (FleetTable) component tests -- verifies device data rendering,
 * loading state, empty state, and table structure.
 *
 * Tests the FleetTable component directly since DevicesPage is tightly coupled
 * to TanStack Router file-based routing (Route.useParams/useSearch).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@/test/test-utils'
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

    // Wait for data to load
    expect(await screen.findByText('router-office-1')).toBeInTheDocument()
    expect(screen.getByText('ap-floor2')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument()
  })

  it('renders device model and firmware info', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    expect(await screen.findByText('RB4011')).toBeInTheDocument()
    expect(screen.getByText('cAP ac')).toBeInTheDocument()
    expect(screen.getByText('7.12.1')).toBeInTheDocument()
    expect(screen.getByText('7.10.2')).toBeInTheDocument()
  })

  it('renders empty state when no devices', async () => {
    mockDevicesList.mockResolvedValueOnce(emptyDevices)

    render(<FleetTable tenantId="tenant-1" />)

    expect(await screen.findByText('No devices found')).toBeInTheDocument()
  })

  it('renders loading state', () => {
    // Make the API hang (never resolve)
    mockDevicesList.mockReturnValueOnce(new Promise(() => {}))

    render(<FleetTable tenantId="tenant-1" />)

    expect(screen.getByText('Loading devices...')).toBeInTheDocument()
  })

  it('renders table headers', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByText('router-office-1')

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

    expect(await screen.findByText('core')).toBeInTheDocument()
  })

  it('renders formatted uptime', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByText('router-office-1')

    // 86400 seconds = 1d 0h
    expect(screen.getByText('1d 0h')).toBeInTheDocument()
    // 3600 seconds = 1h 0m
    expect(screen.getByText('1h 0m')).toBeInTheDocument()
  })

  it('shows pagination info', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByText('router-office-1')

    // "Showing 1-2 of 2 devices"
    expect(screen.getByText(/Showing 1/)).toBeInTheDocument()
  })

  it('renders status indicators for online and offline devices', async () => {
    mockDevicesList.mockResolvedValueOnce(testDevices)

    render(<FleetTable tenantId="tenant-1" />)

    await screen.findByText('router-office-1')

    // Status dots should be present -- find by title attribute
    const onlineDot = screen.getByTitle('online')
    const offlineDot = screen.getByTitle('offline')

    expect(onlineDot).toBeInTheDocument()
    expect(offlineDot).toBeInTheDocument()
  })
})
