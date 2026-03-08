import type { Page } from '@playwright/test'

/**
 * Page Object Model for the login page (/login).
 * Encapsulates selectors and actions for login form interaction.
 */
export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login')
  }

  async login(email: string, password: string) {
    await this.page.getByLabel(/email/i).fill(email)
    await this.page.getByLabel(/password/i).fill(password)
    await this.page.getByRole('button', { name: /sign in/i }).click()
  }

  get emailInput() {
    return this.page.getByLabel(/email/i)
  }

  get passwordInput() {
    return this.page.getByLabel(/password/i)
  }

  get submitButton() {
    return this.page.getByRole('button', { name: /sign in/i })
  }

  get errorMessage() {
    return this.page.locator('.text-error')
  }
}
