// Playwright fixtures for the scheduling E2E suite.
//
// The imperative helpers in `helpers/session.ts` keep working for specs that
// haven't migrated yet — fixtures wrap them so new specs (and the gradual
// rewrite) get:
//   - per-test org seeding (no boilerplate)
//   - automatic session attachment (`authedPage`)
//   - composable overrides via `test.use({ orgInput: { ... } })`
//
// Usage:
//   import { test, expect } from '../fixtures'
//
//   test('agenda renders', async ({ authedPage }) => { ... })
//
//   test.describe('multi-unit org', () => {
//     test.use({ orgInput: { unitCount: 3 } })
//     test('...', async ({ org, authedPage }) => { ... })
//   })

import { test as base, expect, type Page } from '@playwright/test'
import {
  seedOrg,
  signInAndAttachSession,
  type SeedOrgInput,
  type SeededOrg,
} from './helpers/session'

type OrgFixtures = {
  // Override per-test/per-describe via `test.use({ orgInput: { ... } })`.
  orgInput: SeedOrgInput
  // Per-test seeded org. Resolved once per test, before any other fixture
  // that depends on it.
  org: SeededOrg
  // Browser page already wired to the org's session cookie. Use this
  // instead of the default `page` for any spec that hits an authenticated
  // route — it skips the manual `signInAndAttachSession` call.
  authedPage: Page
}

export const test = base.extend<OrgFixtures>({
  orgInput: [{}, { option: true }],

  org: async ({ orgInput }, use) => {
    const seed = await seedOrg(orgInput)
    await use(seed)
  },

  authedPage: async ({ context, page, org, baseURL }, use) => {
    await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)
    await use(page)
  },
})

export { expect }
