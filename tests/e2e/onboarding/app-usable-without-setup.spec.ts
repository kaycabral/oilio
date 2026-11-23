import { expect, test } from '../fixtures'

//   global gate).

const INTERNAL_ROUTES = [
  '/dashboard',
  '/organizations',
  '/catalog',
  '/team',
  '/customers',
  '/plans',
] as const

test.describe('Onboarding — app usable without setup (#986)', { tag: '@critical' }, () => {
  test.use({
    orgInput: { unitCount: 1, memberOperationCount: 0 },
  })

  test('AC-01/AC-02: minimal org reaches every internal route without an onboarding gate', async ({
    authedPage,
  }) => {
    for (const route of INTERNAL_ROUTES) {
      await authedPage.goto(route)

      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/login(\/|$)/)

      await expect(authedPage).toHaveURL(new RegExp(`${route}(/|\\?|$)`))
      await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
    }
  })

  test('com unidade de agendamento: /agenda resolve sem exigir setup', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda(\/|\?|$)/)
    await expect(authedPage.getByRole('link', { name: 'Agenda' })).toBeVisible()
  })

  test('usuário autenticado em `/` cai no app, não na landing pública', async ({ authedPage }) => {
    await authedPage.goto('/')
    await expect(authedPage).toHaveURL(/\/dashboard$/)
    await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
  })

  test.describe('org sem unidade (recém-signup)', () => {
    test.use({ orgInput: { unitCount: 0, memberOperationCount: 0 } })

    test('dono com 0 unidades cai no app sem gate de onboarding', async ({ authedPage }) => {
      await authedPage.goto('/dashboard')
      await expect(authedPage).toHaveURL(/\/dashboard(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
    })
  })
})
