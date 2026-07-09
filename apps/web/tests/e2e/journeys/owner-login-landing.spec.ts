import { expect, test } from '../fixtures'
import { seedAuthUser, seedOrg, signInAndAttachSession } from '../helpers/session'

test.describe('Owner — login → landing por estado (#1076 · 0035)', { tag: '@critical' }, () => {
  test('sem org (perfil completo) → /onboarding (nunca preso no Hero)', async ({
    context,
    page,
    baseURL,
  }) => {
    const user = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, user.email, user.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/onboarding$/)
    await expect(page.getByRole('link', { name: 'Entrar' })).toHaveCount(0)
  })

  test('completion pendente → /onboarding/profile', async ({ context, page, baseURL }) => {
    const user = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, user.email, user.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/onboarding\/profile/)
    await expect(page.getByRole('heading', { name: /completar seu cadastro/i })).toBeVisible()
  })

  test('com org (completo) → /dashboard', async ({ context, page, baseURL }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('link', { name: 'Entrar' })).toHaveCount(0)
  })
})
