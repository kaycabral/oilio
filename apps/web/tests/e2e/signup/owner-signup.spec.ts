import { expect, test } from '../fixtures'
import { seedAuthUser, seedOrg, signInAndAttachSession } from '../helpers/session'

test.describe('Entrada do dono — /signup/business (#1436)', { tag: '@critical' }, () => {
  test('a tela do dono mostra a marca, a cópia de criar negócio e o Google', async ({ page }) => {
    await page.goto('/signup/business')
    await expect(page.getByRole('heading', { name: /crie seu negócio no oilio/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /entrar/i })).toHaveAttribute('href', '/login')
  })

  test('dono autentica e cria o negócio ponta a ponta → /dashboard', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/onboarding$/)
    await expect(page.getByRole('heading', { name: /dê um nome ao seu negócio/i })).toBeVisible()

    await page.getByLabel(/nome do negócio/i).fill('Barbearia do Bairro')
    await page.getByRole('combobox', { name: /segmento/i }).click()
    await page.getByRole('option', { name: 'Barbearia' }).click()
    await page.getByRole('button', { name: /criar negócio/i }).click()

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 })
  })

  test('dono que já tem negócio não recria — cai em /dashboard', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
