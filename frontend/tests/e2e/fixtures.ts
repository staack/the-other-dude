import { test as base } from '@playwright/test'

/**
 * Extended test fixture that uses the authenticated session
 * from auth.setup.ts. All tests importing from this file
 * will run as the logged-in admin user.
 */
export const test = base.extend({
  storageState: 'tests/e2e/.auth/user.json',
})

export { expect } from '@playwright/test'
