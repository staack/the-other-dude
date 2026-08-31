/**
 * Role-helper tests.
 *
 * These exist because the sidebar gates entries on these helpers, and some
 * entries render for only one role. The Transparency entry is gated on
 * isTenantAdmin to match the route's own check -- if that helper were ever
 * narrowed to tenant_admin alone, the entry would silently disappear for
 * super_admins while the route kept working, which is exactly the kind of
 * drift that made two routes unreachable in the first place.
 */

import { describe, it, expect } from 'vitest'
import { isSuperAdmin, isTenantAdmin, isOperator } from '../auth'

// UserMe is not exported, so take the parameter type from the helper itself.
type MaybeUser = Parameters<typeof isTenantAdmin>[0]

const asUser = (role: string) => ({ role }) as NonNullable<MaybeUser>

describe('isTenantAdmin', () => {
  it('is true for tenant_admin', () => {
    expect(isTenantAdmin(asUser('tenant_admin'))).toBe(true)
  })

  it('is ALSO true for super_admin -- the gate must be inclusive', () => {
    expect(isTenantAdmin(asUser('super_admin'))).toBe(true)
  })

  it('is false for operator and viewer', () => {
    expect(isTenantAdmin(asUser('operator'))).toBe(false)
    expect(isTenantAdmin(asUser('viewer'))).toBe(false)
  })

  it('is false for a missing user', () => {
    expect(isTenantAdmin(null)).toBe(false)
  })
})

describe('isSuperAdmin', () => {
  it('is true only for super_admin', () => {
    expect(isSuperAdmin(asUser('super_admin'))).toBe(true)
    expect(isSuperAdmin(asUser('tenant_admin'))).toBe(false)
    expect(isSuperAdmin(null)).toBe(false)
  })
})

describe('isOperator', () => {
  it('includes every role at or above operator', () => {
    expect(isOperator(asUser('operator'))).toBe(true)
    expect(isOperator(asUser('tenant_admin'))).toBe(true)
    expect(isOperator(asUser('super_admin'))).toBe(true)
  })

  it('excludes viewer', () => {
    expect(isOperator(asUser('viewer'))).toBe(false)
  })
})
