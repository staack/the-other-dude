import { test as setup, expect } from '@playwright/test'

const authFile = 'tests/e2e/.auth/user.json'

setup('authenticate', async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'
  await page.goto(`${baseURL}/login`)

  // Use legacy-auth test user (no SRP/Secret Key required)
  await page.getByLabel(/email/i).fill(
    process.env.TEST_ADMIN_EMAIL || 'e2e-test@the-other-dude.dev'
  )
  await page.getByLabel(/password/i).fill(
    process.env.TEST_ADMIN_PASSWORD || 'admin123'
  )
  await page.getByRole('button', { name: /sign in/i }).click()

  // Legacy auth user may trigger SRP upgrade dialog -- dismiss if present
  const upgradeDialog = page.getByRole('dialog')
  if (await upgradeDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Skip/cancel the SRP upgrade for E2E testing
    const skipButton = page.getByRole('button', { name: /skip|cancel|later|close/i })
    if (await skipButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skipButton.click()
    }
  }

  // Wait for redirect to dashboard (/ or /tenants/...)
  await expect(page).toHaveURL(/\/$|\/tenants/, { timeout: 15000 })

  // Save storage state (cookies + localStorage) for reuse across tests
  await page.context().storageState({ path: authFile })
})
