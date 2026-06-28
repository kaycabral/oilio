import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

// Server-side authorization wall for manageOrg-gated routes (brief 0029, AC-08).
//
// The sidebar hides these routes from non-managers, but that gate is CLIENT-side
// and cosmetic: a receptionist/memberOperation could reach the surface by typing the
// URL. `requireManagerPage` is the server wall that redirects them. This spec
// proves the wall end-to-end on the three routes that previously leaked:
//   /copilot   — financial goal/actuals/projection
//   /team      — member PII (emails, whatsapp) + invites
//   /billing   — plan tier, billed units, billing period
//   /dashboard — financeiro KPIs (faturamento, ticket médio, receita)
//
// It also asserts a manager (owner) DOES reach them, so the guard isn't
// over-restrictive. Regression fence: if a future change drops the guard on one
// of these loaders, the matching case here fails.

const MANAGE_ROUTES = ['/copilot', '/team', '/billing', '/dashboard'] as const

const heading = (page: Page) => page.getByRole('heading', { level: 1 })

test.describe('Acesso direto a rotas manageOrg-gated (AC-08, server wall)', () => {
  test.use({ orgInput: { unitCount: 1 } })

  test('recepção é redirecionada para /agenda ao tentar URL direta', async ({
    authedPage,
    org,
  }) => {
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')

    for (const route of MANAGE_ROUTES) {
      await authedPage.goto(route)
      // The server redirects a non-manager away — they land on /agenda, never on
      // the gated surface.
      await expect(authedPage, `receptionist must not reach ${route}`).toHaveURL(/\/agenda$/)
    }
  })

  test('profissional é redirecionado para /agenda ao tentar URL direta', async ({
    authedPage,
    org,
  }) => {
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'member_operator')

    for (const route of MANAGE_ROUTES) {
      await authedPage.goto(route)
      await expect(authedPage, `memberOperation must not reach ${route}`).toHaveURL(/\/agenda$/)
    }
  })

  test('owner (manager) alcança todas as rotas', async ({ authedPage }) => {
    // The seeded member is the owner — no demotion. Each route renders its own
    // page (URL stays put, an h1 shows), proving the guard lets managers through.
    for (const route of MANAGE_ROUTES) {
      await authedPage.goto(route)
      await expect(authedPage, `owner should reach ${route}`).toHaveURL(new RegExp(`${route}$`))
      await expect(heading(authedPage)).toBeVisible()
    }
  })
})
