import { describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OperationsView, type OperationsViewProps } from './OperationsView'
import type { FleetDevice } from '@/lib/api'
const props: OperationsViewProps = {
  devices: [],
  alerts: [],
  now: Date.now(),
  updatedAt: 0,
  incomplete: false,
  refreshing: false,
  selected: '',
  onSelect: vi.fn(),
  onRefresh: vi.fn(),
  deviceHref: (id) => `/device/${id}`,
  fleetHref: '/fleet',
}
describe('Operations review', () => {
  it('never shows a healthy or quiet conclusion on a failed evidence fetch', () => {
    render(<OperationsView {...props} incomplete />)
    expect(screen.getByText('Monitoring is incomplete')).toBeInTheDocument()
    expect(screen.queryByText('Nothing requires triage in this snapshot')).not.toBeInTheDocument()
    cleanup()
  })
  it('keeps keyboard focus on the selected queue item', async () => {
    const onSelect = vi.fn()
    const devices = [
      { id: 'a', hostname: 'AP', status: 'offline', last_seen: null },
      { id: 'b', hostname: 'Router', status: 'degraded', last_seen: null },
    ] as FleetDevice[]
    const view = render(<OperationsView {...props} devices={devices} onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: /Reported degraded.*Router/ })
    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('status:b')
    view.rerender(
      <OperationsView {...props} devices={devices} onSelect={onSelect} selected="status:b" />,
    )
    expect(button).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Inspect device →' })).toHaveAttribute(
      'href',
      '/device/b',
    )
    cleanup()
  })
})
