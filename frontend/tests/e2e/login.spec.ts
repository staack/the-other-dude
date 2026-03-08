import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/login.page'

// Login tests must run WITHOUT stored auth state
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Login Flow', () => {
  test('should show login page with email and password fields', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await expect(loginPage.emailInput).toBeVisible()
    await expect(loginPage.passwordInput).toBeVisible()
    await expect(loginPage.submitButton).toBeVisible()
  })

  test('should show error on invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login('wrong@example.com', 'wrongpassword')
    // Should stay on login page or show error
    await page.waitForTimeout(3000)
    const onLogin = page.url().includes('/login')
    const hasError = (await page.locator('[data-testid="login-error"]').count()) > 0
    expect(onLogin || hasError).toBe(true)
  })

  test('should redirect to dashboard on valid login', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login(
      process.env.TEST_ADMIN_EMAIL || 'e2e-test@mikrotik-portal.dev',
      process.env.TEST_ADMIN_PASSWORD || 'admin123'
    )
    // Legacy auth user may trigger SRP upgrade dialog -- handle it
    const upgradeDialog = page.getByRole('dialog')
    if (await upgradeDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      const skipButton = page.getByRole('button', { name: /skip|cancel|later|close/i })
      if (await skipButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await skipButton.click()
      }
    }
    // Should redirect away from login after successful auth
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 })
  })

  test('should display TOD branding', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await expect(page.getByText('TOD - The Other Dude')).toBeVisible()
    await expect(page.getByText('MSP Fleet Management')).toBeVisible()
  })

  test('should disable submit button when fields are empty', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await expect(loginPage.submitButton).toBeDisabled()
  })
})
