import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@/test/test-utils'
import { WirelessTab } from '@/components/monitoring/WirelessTab'

const api = vi.hoisted(() => ({ latest: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/api', () => ({
  metricsApi: { wirelessLatest: api.latest, wireless: api.history },
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ data }: { data: unknown }) => <div data-testid="client-chart">{JSON.stringify(data)}</div>,
  Area: () => null,
  XAxis: () => null,
  CartesianGrid: () => null,
}))

const radio = (name: string, clients: number | null) => ({
  interface: name, client_count: clients, avg_signal: null, ccq: null,
  frequency: null, time: '2026-10-06T20:00:00Z',
})

describe('Wireless monitoring states', () => {
  beforeEach(() => {
    api.latest.mockReset().mockResolvedValue([])
    api.history.mockReset().mockResolvedValue([])
  })

  it('does not infer absent radios or zero clients from missing telemetry', async () => {
    render(<WirelessTab tenantId="tenant" deviceId="device" />)
    expect(await screen.findByText('No wireless monitoring data available yet.')).toBeInTheDocument()
    expect(screen.queryByText(/No wireless interfaces detected/)).not.toBeInTheDocument()
    expect(screen.queryByText('No wireless clients connected.')).not.toBeInTheDocument()
  })

  it('keeps both zero-client radios and their zero-valued charts visible', async () => {
    api.latest.mockResolvedValue([radio('wifi1', 0), radio('wifi2', 0)])
    api.history.mockResolvedValue(['wifi1', 'wifi2'].map((name) => ({
      bucket: '2026-10-06T20:00:00Z', interface: name, avg_clients: 0,
      max_clients: 0, avg_signal: null, avg_ccq: null, frequency: null,
    })))
    render(<WirelessTab tenantId="tenant" deviceId="device" />)
    expect(await screen.findByText('No wireless clients connected.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'wifi1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'wifi2' })).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(2)
    for (const chart of screen.getAllByTestId('client-chart')) {
      expect(chart).toHaveTextContent('"clients":0')
    }
  })

  it.each([1, null])('does not claim zero clients for a reading of %s', async (count) => {
    api.latest.mockResolvedValue([radio('wifi1', count)])
    render(<WirelessTab tenantId="tenant" deviceId="device" />)
    expect(await screen.findByRole('heading', { name: 'wifi1' })).toBeInTheDocument()
    expect(screen.queryByText('No wireless clients connected.')).not.toBeInTheDocument()
  })

  it('reports a query failure instead of claiming missing radios or clients', async () => {
    api.latest.mockRejectedValue(new Error('request failed'))
    render(<WirelessTab tenantId="tenant" deviceId="device" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load wireless monitoring data.')
    expect(screen.queryByText('No wireless monitoring data available yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No wireless clients connected.')).not.toBeInTheDocument()
  })
})
