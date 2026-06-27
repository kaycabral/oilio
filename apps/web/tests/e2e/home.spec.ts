import { expect, test } from './fixtures'

test.describe('Landing pública', () => {
  test('renderiza o hero e converte pro login', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', {
        name: /a plataforma para o seu estabelecimento crescer com recorrência/i,
      }),
    ).toBeVisible()
    // CTA principal leva pro login (que cuida de signup + login).
    await expect(page.getByRole('link', { name: 'Começar agora' }).first()).toHaveAttribute(
      'href',
      '/login',
    )
  })

  test('navega da landing pra página de preços', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Preços' }).first().click()
    await expect(page).toHaveURL(/\/pricing$/)
    await expect(
      page.getByRole('heading', { name: /um plano para cada estágio do seu estabelecimento/i }),
    ).toBeVisible()
  })

  test('a página de preços mostra os três planos e converte pro login', async ({ page }) => {
    await page.goto('/pricing')
    // Nomes dos planos com `exact` — o copy "Tudo do Starter, e mais:" dos cards
    // seguintes casaria um `getByText` não-exato (strict mode violation).
    await expect(page.getByText('Starter', { exact: true })).toBeVisible()
    await expect(page.getByText('Pro', { exact: true })).toBeVisible()
    await expect(page.getByText('Avançado', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
