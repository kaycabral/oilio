import { expect, test } from './fixtures'

test.describe('Landing pública', () => {
  test('renderiza o hero e converte pro login', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', {
        name: /pare de vender atendimento\. comece a construir receita\./i,
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
      page.getByRole('heading', { name: /um plano para cada estágio do seu negócio/i }),
    ).toBeVisible()
  })

  test('a página de preços mostra os três planos e converte pro login', async ({ page }) => {
    await page.goto('/pricing')
    // Nomes dos planos com `exact` — o copy "Tudo do Grátis, e mais:" dos cards
    // seguintes casaria um `getByText` não-exato (strict mode violation).
    await expect(page.getByText('Grátis', { exact: true })).toBeVisible()
    await expect(page.getByText('Pro', { exact: true })).toBeVisible()
    await expect(page.getByText('Avançado', { exact: true })).toBeVisible()
    await expect(page.getByText('Escala', { exact: true })).toBeVisible()
    // The CTA for a chargeable tier carries the billing intent: `next` lands the
    // visitor on /billing after auth, `intent` names the picked tier so the
    // post-login flow can offer it directly (PricingTiers.ctaHref, milestone
    // v0.13.0 billing). Free stays a bare /login. The sibling unit test was
    // aligned in d5f8b61a; this is the e2e catching up.
    await expect(page.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute(
      'href',
      '/login?next=%2Fbilling&intent=pro',
    )
  })
})
