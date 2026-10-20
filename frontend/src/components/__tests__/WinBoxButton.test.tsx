import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { WinBoxButton } from '@/components/fleet/WinBoxButton'

const openWinbox = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ remoteAccessApi: { openWinbox, closeWinbox: vi.fn() } }))

afterEach(() => vi.restoreAllMocks())

describe('native WinBox launch', () => {
  it.each(['Macintosh', 'Linux', 'Windows'])('launches on %s and retains a direct retry link', async (platform) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
    const launch = vi.spyOn(window, 'open').mockReturnValue(null)
    openWinbox.mockResolvedValue({ tunnel_id: 'tunnel', host: 'tod.example', port: 49000, winbox_uri: 'winbox://tod.example:49000' })
    render(<WinBoxButton tenantId="tenant" deviceId="device" />)
    fireEvent.click(screen.getByRole('button', { name: 'WinBox' }))
    const link = await screen.findByRole('link', { name: 'Open WinBox' })
    expect(launch).toHaveBeenCalledWith('winbox://tod.example:49000', '_self')
    expect(link).toHaveAttribute('href', 'winbox://tod.example:49000')
    expect(screen.getByText('Tunnel ready:', { exact: false })).toBeInTheDocument()
  })
})
