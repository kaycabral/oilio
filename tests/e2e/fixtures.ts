import { test as base, expect, type Page } from '@playwright/test'
import {
  seedOrg,
  signInAndAttachSession,
  type SeedOrgInput,
  type SeededOrg,
} from './helpers/session'

type OrgFixtures = {
  orgInput: SeedOrgInput
  org: SeededOrg
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
