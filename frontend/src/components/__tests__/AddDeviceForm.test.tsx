import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { AddDeviceForm } from '@/components/fleet/AddDeviceForm'

const createDevice = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    devicesApi: { ...actual.devicesApi, create: createDevice },
    vpnApi: { ...actual.vpnApi, getConfig: vi.fn().mockResolvedValue(null) },
    credentialProfilesApi: { ...actual.credentialProfilesApi, list: vi.fn().mockResolvedValue([]) },
  }
})
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

describe('RouterOS initial display name', () => {
  beforeEach(() => {
    createDevice.mockReset()
    createDevice.mockResolvedValue({ id: 'device-id', hostname: 'router-identity' })
  })

  it.each([
    ['', undefined],
    ['   ', undefined],
    ['operator-name', 'operator-name'],
  ])('submits %j without substituting the IP', async (name, expected) => {
    render(<AddDeviceForm tenantId="tenant-id" open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('IP Address *'), { target: { value: '192.0.2.1' } })
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: name } })
    fireEvent.change(screen.getByLabelText('Username *'), { target: { value: 'test' } })
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'test' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add Device$/ }))
    await waitFor(() => expect(createDevice).toHaveBeenCalledOnce())
    expect(createDevice).toHaveBeenCalledWith('tenant-id', expect.objectContaining({
      hostname: expected, ip_address: '192.0.2.1',
    }))
  })
})
