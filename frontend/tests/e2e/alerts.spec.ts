import { test, expect } from './fixtures'

test.describe('Alerts Page', () => {
  test('should display alerts page content', async ({ page }) => {
    await page.goto('/alerts')
    // Should show alerts content or empty state
    await page.waitForTimeout(2000)
    const hasAlerts = (await page.locator('table').count()) > 0
    const hasEmptyState =
      (await page.getByText(/no active alerts|all clear|no alerts|select an organization/i).count()) > 0
    const hasHeading = (await page.getByText(/alerts/i).count()) > 0
    expect(hasAlerts || hasEmptyState || hasHeading).toBe(true)
  })

  test('should navigate back to dashboard from alerts', async ({ page }) => {
    await page.goto('/alerts')
    // Click dashboard link in sidebar
    await page.getByRole('link', { name: /dashboard|fleet/i }).first().click()
    await expect(page).toHaveURL(/^\/$|\/tenants/)
  })

  test('should stay authenticated on alerts page', async ({ page }) => {
    await page.goto('/alerts')
    // Should not redirect to login
    await expect(page).not.toHaveURL(/login/)
    // Sidebar should be visible (authenticated layout)
    await expect(page.locator('nav').first()).toBeVisible()
  })
})
