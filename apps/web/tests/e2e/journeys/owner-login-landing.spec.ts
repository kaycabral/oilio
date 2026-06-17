// Journey E2E for #1076 (brief 0035 AC-02) — the post-login landing chain, the
// composite that a "básico" redirect bug slipped through. An authenticated user
// hitting `/` was stuck on the public Hero ("Entrar"); `page.tsx` now sends them
// into the app and `(app)/layout` resolves the destination by state. This spec
// asserts ALL THREE branches end IN the app, never on the Hero — the bug becomes
// a covered regression.
//
//   sem tenant            → /onboarding
//   completion pendente   → /onboarding/profile
//   com tenant (completo) → /dashboard

import { expect, test } from '../fixtures'
import { seedAuthUser, seedTenant, signInAndAttachSession } from '../helpers/session'

test.describe('Owner — login → landing por estado (#1076 · 0035)', { tag: '@critical' }, () => {
  test('sem tenant (perfil completo) → /onboarding (nunca preso no Hero)', async ({
    context,
    page,
    baseURL,
  }) => {
    const user = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, user.email, user.password, baseURL ?? undefined)

    // O bug: autenticado em `/` ficava no Hero público. Agora é roteado pro app.
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

  test('com tenant (completo) → /dashboard', async ({ context, page, baseURL }) => {
    const seed = await seedTenant({ unitCount: 1, professionalCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('link', { name: 'Entrar' })).toHaveCount(0)
  })
})
