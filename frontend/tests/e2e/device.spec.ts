import { test, expect } from './fixtures'

test.describe('Device Navigation', () => {
  test('should navigate to device list from dashboard', async ({ page }) => {
    await page.goto('/')
    // Click Devices in sidebar
    await page.getByRole('link', { name: /devices/i }).first().click()
    // Super_admin may land on /tenants (org picker) or /devices depending on tenant context
    await expect(page).toHaveURL(/devices|tenants/, { timeout: 5000 })
    // Look for device table, org list, or empty state
    await page.waitForTimeout(2000)
    const hasTable = (await page.locator('table').count()) > 0
    const hasEmptyState =
      (await page.getByText(/no devices|add your first|select an organization|organizations/i).count()) > 0
    expect(hasTable || hasEmptyState).toBe(true)
  })

  test('should open command palette with Cmd+K', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000) // Wait for app to fully load
    // Open command palette
    await page.keyboard.press('Meta+k')
    // Command palette dialog should appear
    const dialog = page.locator('[cmdk-dialog], [role="dialog"]')
    await expect(dialog.first()).toBeVisible({ timeout: 3000 })
  })

  test('should close command palette with Escape', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    // Open command palette
    await page.keyboard.press('Meta+k')
    const dialog = page.locator('[cmdk-dialog], [role="dialog"]')
    await expect(dialog.first()).toBeVisible({ timeout: 3000 })
    // Close with Escape
    await page.keyboard.press('Escape')
    await expect(dialog.first()).not.toBeVisible({ timeout: 3000 })
  })
})
