/**
 * TemplatePushWizard component tests -- verifies multi-step wizard navigation,
 * device selection, variable input, preview, and confirmation steps.
 *
 * The wizard has 5 steps: targets -> variables -> preview -> confirm -> progress.
 * Tests mock the API layer (metricsApi.fleetSummary, deviceGroupsApi.list,
 * templatesApi.preview/push) and interact via user events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import type { TemplateResponse, VariableDef } from '@/lib/templatesApi'
import type { FleetDevice, DeviceGroupResponse } from '@/lib/api'

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

const mockFleetSummary = vi.fn()
const mockGroupsList = vi.fn()
const mockPreview = vi.fn()
const mockPush = vi.fn()

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    metricsApi: {
      ...actual.metricsApi,
      fleetSummary: (...args: unknown[]) => mockFleetSummary(...args),
    },
    deviceGroupsApi: {
      ...actual.deviceGroupsApi,
      list: (...args: unknown[]) => mockGroupsList(...args),
    },
  }
})

vi.mock('@/lib/templatesApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/templatesApi')>('@/lib/templatesApi')
  return {
    ...actual,
    templatesApi: {
      ...actual.templatesApi,
      preview: (...args: unknown[]) => mockPreview(...args),
      push: (...args: unknown[]) => mockPush(...args),
      pushStatus: vi.fn().mockResolvedValue({ rollout_id: 'r1', jobs: [] }),
    },
  }
})

// --------------------------------------------------------------------------
// Test data
// --------------------------------------------------------------------------

const testDevices: FleetDevice[] = [
  {
    id: 'dev-1',
    hostname: 'router-main',
    ip_address: '192.168.1.1',
    status: 'online',
    model: 'RB4011',
    last_seen: '2026-03-01T12:00:00Z',
    uptime_seconds: 86400,
    last_cpu_load: 15,
    last_memory_used_pct: 45,
    latitude: null,
    longitude: null,
    tenant_id: 'tenant-1',
    tenant_name: 'Test Tenant',
  },
  {
    id: 'dev-2',
    hostname: 'ap-office',
    ip_address: '192.168.1.10',
    status: 'online',
    model: 'cAP ac',
    last_seen: '2026-03-01T11:00:00Z',
    uptime_seconds: 3600,
    last_cpu_load: 5,
    last_memory_used_pct: 30,
    latitude: null,
    longitude: null,
    tenant_id: 'tenant-1',
    tenant_name: 'Test Tenant',
  },
  {
    id: 'dev-3',
    hostname: 'switch-floor1',
    ip_address: '192.168.1.20',
    status: 'offline',
    model: 'CRS326',
    last_seen: '2026-02-28T10:00:00Z',
    uptime_seconds: null,
    last_cpu_load: null,
    last_memory_used_pct: null,
    latitude: null,
    longitude: null,
    tenant_id: 'tenant-1',
    tenant_name: 'Test Tenant',
  },
]

const testGroups: DeviceGroupResponse[] = [
  { id: 'grp-1', name: 'Core Routers', description: null, device_count: 2, created_at: '2026-01-01T00:00:00Z' },
]

const templateWithVars: TemplateResponse = {
  id: 'tmpl-1',
  name: 'Firewall Rules',
  description: 'Standard firewall policy',
  content: '/ip firewall filter add chain=input action=drop',
  variables: [
    { name: 'device', type: 'string', default: null, description: 'Auto-populated device context' },
    { name: 'dns_server', type: 'ip', default: '8.8.8.8', description: 'Primary DNS' },
    { name: 'enable_logging', type: 'boolean', default: 'false', description: 'Enable firewall logging' },
  ],
  tags: ['firewall', 'security'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
}

const templateNoVars: TemplateResponse = {
  id: 'tmpl-2',
  name: 'NTP Config',
  description: 'Set NTP servers',
  content: '/system ntp client set enabled=yes',
  variables: [
    { name: 'device', type: 'string', default: null, description: 'Auto-populated device context' },
  ],
  tags: ['ntp'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
}

// --------------------------------------------------------------------------
// Component import (after mocks)
// --------------------------------------------------------------------------
import { TemplatePushWizard } from '@/components/templates/TemplatePushWizard'

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('TemplatePushWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFleetSummary.mockResolvedValue(testDevices)
    mockGroupsList.mockResolvedValue(testGroups)
    mockPreview.mockResolvedValue({ rendered: '/ip firewall filter add chain=input', device_hostname: 'router-main' })
    mockPush.mockResolvedValue({ rollout_id: 'rollout-1', jobs: [] })
  })

  it('renders wizard with first step active (target selection)', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    // Title shows template name and step info
    expect(await screen.findByText(/Push Template: Firewall Rules/)).toBeInTheDocument()
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument()

    // Target selection description
    expect(screen.getByText(/Select devices to push the template to/)).toBeInTheDocument()
  })

  it('displays device list for selection', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    // Wait for devices to load
    expect(await screen.findByText('router-main')).toBeInTheDocument()
    expect(screen.getByText('ap-office')).toBeInTheDocument()
    expect(screen.getByText('switch-floor1')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument()
  })

  it('disables Next button when no devices selected', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    await screen.findByText('router-main')

    // Next button should be disabled with 0 selected
    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect(nextBtn).toBeDisabled()
  })

  it('enables Next button after selecting a device', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Click on the device label to toggle the checkbox
    const deviceLabel = screen.getByText('router-main')
    // The device is inside a <label> element so clicking it toggles checkbox
    await user.click(deviceLabel)

    // The selected count updates
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    // Next button should be enabled
    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect(nextBtn).not.toBeDisabled()
  })

  it('navigates to variables step when template has user variables', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select a device
    await user.click(screen.getByText('router-main'))

    // Click Next
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Should now be on variables step (step 2)
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument()
    expect(screen.getByText(/Provide values for template variables/)).toBeInTheDocument()
  })

  it('displays variable inputs for selected template', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select a device and go to variables
    await user.click(screen.getByText('router-main'))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Variable inputs should appear (excluding 'device' which is auto-populated)
    expect(screen.getByText('dns_server')).toBeInTheDocument()
    expect(screen.getByText('enable_logging')).toBeInTheDocument()
    expect(screen.getByText(/Primary DNS/)).toBeInTheDocument()
    expect(screen.getByText(/Enable firewall logging/)).toBeInTheDocument()
  })

  it('skips variables step when template has no user variables', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateNoVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select a device
    await user.click(screen.getByText('router-main'))

    // Click Next -- should skip variables and go to preview (step 3)
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Should be on preview step
    expect(screen.getByText(/Preview the rendered template/)).toBeInTheDocument()
  })

  it('can navigate back to previous step', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select device and go to variables
    await user.click(screen.getByText('router-main'))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument()

    // Click Back
    await user.click(screen.getByRole('button', { name: /back/i }))

    // Should be back on step 1
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument()
    expect(screen.getByText(/Select devices to push the template to/)).toBeInTheDocument()
  })

  it('shows confirmation step with summary before push', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select device
    await user.click(screen.getByText('router-main'))

    // Step 1 -> 2 (variables)
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 2 -> 3 (preview)
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Wait for preview to load
    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalled()
    })

    // Step 3 -> 4 (confirm)
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Confirmation step should show warning and summary
    expect(screen.getByText(/This will push configuration to/)).toBeInTheDocument()
    // The summary shows "Template: Firewall Rules" and "Devices: router-main"
    expect(screen.getByText('Template: Firewall Rules')).toBeInTheDocument()
    expect(screen.getByText('Devices: router-main')).toBeInTheDocument()
  })

  it('shows push button on confirmation step', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select device
    await user.click(screen.getByText('router-main'))

    // Step 1 -> 2 (variables)
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 2 -> 3 (preview, via goToPreview which triggers mutation)
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalled()
    })

    // Step 3 -> 4 (confirm)
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Push button should exist
    const pushBtn = screen.getByRole('button', { name: /push to 1 device/i })
    expect(pushBtn).toBeInTheDocument()
    expect(pushBtn).not.toBeDisabled()
  })

  it('shows auto-populated variable info on variables step', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select device and go to variables
    await user.click(screen.getByText('router-main'))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Auto-populated notice should be visible
    expect(screen.getByText(/Auto-populated/)).toBeInTheDocument()
  })

  it('shows selected device count in target step', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Initial: 0 selected
    expect(screen.getByText(/0 selected/)).toBeInTheDocument()

    // Select two devices
    await user.click(screen.getByText('router-main'))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    await user.click(screen.getByText('ap-office'))
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <TemplatePushWizard
        open={false}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    // Dialog should not render content when closed
    expect(screen.queryByText(/Push Template/)).not.toBeInTheDocument()
  })

  it('triggers preview API when navigating to preview step via goToPreview', async () => {
    render(
      <TemplatePushWizard
        open={true}
        onClose={vi.fn()}
        tenantId="tenant-1"
        template={templateWithVars}
      />
    )

    const user = userEvent.setup()

    await screen.findByText('router-main')

    // Select device
    await user.click(screen.getByText('router-main'))

    // Step 1 -> 2 (variables)
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 2 -> 3 (preview via goToPreview, which auto-triggers preview for first device)
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Preview API should be called with the template and first selected device
    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalledWith(
        'tenant-1',
        'tmpl-1',
        'dev-1',
        expect.any(Object)
      )
    })
  })
})
