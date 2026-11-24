import { expect, test } from './fixtures'

test.describe('Landing pública', () => {
  test('renderiza o hero e converte pro login', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', {
        name: /pare de vender atendimento\. comece a construir receita\./i,
      }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Começar agora' }).first()).toHaveAttribute(
      'href',
      '/signup/business',
    )
  })

  test('navega da landing pra página de preços', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Preços' }).first().click()
    await expect(page).toHaveURL(/\/pricing$/)
    await expect(
      page.getByRole('heading', { name: /um plano para cada estágio do seu negócio/i }),
    ).toBeVisible()
  })

  test('a página de preços mostra os três planos e converte pro login', async ({ page }) => {
    await page.goto('/pricing')
    const tiers = page.getByRole('list', { name: 'Planos' })
    await expect(tiers.getByText('Grátis', { exact: true })).toBeVisible()
    await expect(tiers.getByText('Pro', { exact: true })).toBeVisible()
    await expect(tiers.getByText('Avançado', { exact: true })).toBeVisible()
    await expect(tiers.getByText('Escala', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute(
      'href',
      '/signup/business?intent=pro',
    )
  })
})
