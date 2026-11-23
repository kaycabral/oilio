import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

const MANAGE_ROUTES = ['/copilot', '/team', '/settings/billing', '/dashboard'] as const

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
    for (const route of MANAGE_ROUTES) {
      await authedPage.goto(route)
      await expect(authedPage, `owner should reach ${route}`).toHaveURL(new RegExp(`${route}$`))
      await expect(heading(authedPage)).toBeVisible()
    }
  })
})
