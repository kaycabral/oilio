// Playwright fixtures for the scheduling E2E suite.
//
// The imperative helpers in `helpers/session.ts` keep working for specs that
// haven't migrated yet — fixtures wrap them so new specs (and the gradual
// rewrite) get:
//   - per-test tenant seeding (no boilerplate)
//   - automatic session attachment (`authedPage`)
//   - composable overrides via `test.use({ tenantInput: { ... } })`
//
// Usage:
//   import { test, expect } from '../fixtures'
//
//   test('agenda renders', async ({ authedPage }) => { ... })
//
//   test.describe('multi-unit tenant', () => {
//     test.use({ tenantInput: { unitCount: 3 } })
//     test('...', async ({ tenant, authedPage }) => { ... })
//   })

import { test as base, expect, type Page } from '@playwright/test'
import {
  seedTenant,
  signInAndAttachSession,
  type SeedTenantInput,
  type SeededTenant,
} from './helpers/session'

type TenantFixtures = {
  // Override per-test/per-describe via `test.use({ tenantInput: { ... } })`.
  tenantInput: SeedTenantInput
  // Per-test seeded tenant. Resolved once per test, before any other fixture
  // that depends on it.
  tenant: SeededTenant
  // Browser page already wired to the tenant's session cookie. Use this
  // instead of the default `page` for any spec that hits an authenticated
  // route — it skips the manual `signInAndAttachSession` call.
  authedPage: Page
}

export const test = base.extend<TenantFixtures>({
  tenantInput: [{}, { option: true }],

  tenant: async ({ tenantInput }, use) => {
    const seed = await seedTenant(tenantInput)
    await use(seed)
  },

  authedPage: async ({ context, page, tenant, baseURL }, use) => {
    await signInAndAttachSession(context, tenant.email, tenant.password, baseURL ?? undefined)
    await use(page)
  },
})

export { expect }
