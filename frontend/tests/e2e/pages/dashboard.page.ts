import type { Page } from '@playwright/test'

/**
 * Page Object Model for the fleet dashboard (/).
 * Encapsulates selectors for dashboard elements.
 */
export class DashboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/')
  }

  get heading() {
    return this.page.getByRole('heading').first()
  }

  get sidebar() {
    return this.page.locator('nav').first()
  }

  get deviceRows() {
    return this.page.locator('table tbody tr, [role="row"]')
  }

  get kpiCards() {
    return this.page.locator('[class*="card"], [class*="Card"]')
  }
}
