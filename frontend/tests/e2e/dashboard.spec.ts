import { test, expect } from './fixtures'
import { DashboardPage } from './pages/dashboard.page'

test.describe('Fleet Dashboard', () => {
  test('should display dashboard after login', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    // Dashboard should load without redirecting to login
    await expect(page).not.toHaveURL(/login/)
    // Should see sidebar navigation
    await expect(dashboard.sidebar).toBeVisible()
  })

  test('should show KPI cards or empty state', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    // Wait for content to load (either KPI cards or empty state)
    await page.waitForTimeout(2000)
    const hasCards = (await dashboard.kpiCards.count()) > 0
    const hasEmptyState =
      (await page.getByText(/no devices|no fleet|add your first/i).count()) > 0
    expect(hasCards || hasEmptyState).toBe(true)
  })

  test('should have working navigation sidebar', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    // Click on Alerts nav item in sidebar
    await page.getByRole('link', { name: /alerts/i }).first().click()
    await expect(page).toHaveURL(/alerts/)
  })

  test('should show Fleet heading or dashboard content', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    // Dashboard should render meaningful content
    await page.waitForTimeout(1000)
    const headingCount = await dashboard.heading.count()
    expect(headingCount).toBeGreaterThan(0)
  })
})
