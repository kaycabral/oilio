import { expect, test } from '../fixtures'
import { seedAuthUser, seedOrg, signInAndAttachSession } from '../helpers/session'

const MONTAGE_MARKER = 'Assinantes ativos'
const HEADING = /entre na sua conta/i
const GOOGLE_BUTTON = /continuar com google/i

test.describe('Login split-screen — DoD Feature-level (#1428 · 0095)', { tag: '@critical' }, () => {
  test('Cenário 1: dono entra pela tela redesenhada e chega ao dashboard', async ({
    context,
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/login')

    await expect(page.getByRole('main')).toContainText('Entre na sua conta')
    await expect(page.getByRole('button', { name: GOOGLE_BUTTON })).toBeVisible()
    await expect(page.getByText(MONTAGE_MARKER).first()).toBeVisible()

    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('Cenário 2: login completo em viewport mobile', async ({ context, page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: HEADING })).toBeVisible()
    await expect(page.getByText(MONTAGE_MARKER).first()).toBeHidden()
    await expect(page.getByText(/sua agenda, assinaturas e caixa num lugar só/i)).toBeVisible()

    const button = page.getByRole('button', { name: GOOGLE_BUTTON })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflows).toBe(false)

    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('Cenário 3: split ativo na faixa de tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/login')

    await expect(page.getByText(MONTAGE_MARKER).first()).toBeVisible()
    await expect(page.getByText(/entre para continuar de onde parou/i)).toBeVisible()
    await expect(page.getByRole('button', { name: GOOGLE_BUTTON })).toBeVisible()
  })

  test('Cenário 4a: sem org (perfil completo) aterrissa em /onboarding', async ({
    context,
    page,
    baseURL,
  }) => {
    const user = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, user.email, user.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/onboarding$/)
  })

  test('Cenário 4b: completion pendente aterrissa em /onboarding/profile', async ({
    context,
    page,
    baseURL,
  }) => {
    const user = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, user.email, user.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/onboarding\/profile/)
  })

  test('Cenário 4c: com org aterrissa em /dashboard', async ({ context, page, baseURL }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
