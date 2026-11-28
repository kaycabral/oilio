import { expect, test } from '../fixtures'
import { expectNotFound } from '../helpers/not-found'

const GATED_ROUTES = [
  '/plans',
  '/plans/new',
  '/subscriptions',
  '/subscriptions/new',
  '/copilot',
  '/reports',
] as const

const GATED_NAV_LABELS = ['Planos', 'Assinaturas', 'Relatórios', 'Copiloto'] as const

test.describe('Billing — tier gating (brief 0088)', { tag: '@critical' }, () => {
  test.describe('Free Negócio — off-plan surfaces hidden + 404', () => {
    test.use({ orgInput: { tier: 'free' } })

    for (const route of GATED_ROUTES) {
      test(`${route} responde 404 no acesso direto (B1)`, async ({ authedPage }) => {
        await expectNotFound(authedPage, route)
        await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toHaveCount(0)
      })
    }

    test('a nav esconde toda superfície fora do plano (B2)', async ({ authedPage }) => {
      await authedPage.goto('/agenda')
      for (const label of GATED_NAV_LABELS) {
        await expect(authedPage.getByRole('link', { name: label })).toHaveCount(0)
      }
      await expect(authedPage.getByRole('link', { name: 'Vendas' })).toBeVisible()
      await expect(authedPage.getByRole('link', { name: 'Clientes' })).toBeVisible()
    })

    test('billing surface segue acessível (não é gated) e oferece o upgrade', async ({
      authedPage,
    }) => {
      await authedPage.goto('/settings/billing')
      await expect(authedPage.getByRole('heading', { name: 'Cobrança' })).toBeVisible()
      await expect(authedPage.getByText('Plano Grátis')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeVisible()
    })
  })

  test.describe('Pro Negócio — tudo funciona, sem regressão (C1)', () => {
    test.use({ orgInput: { tier: 'pro' } })

    test('nav mostra as superfícies e as rotas abrem', async ({ authedPage }) => {
      await authedPage.goto('/agenda')
      for (const label of GATED_NAV_LABELS) {
        await expect(authedPage.getByRole('link', { name: label })).toBeVisible()
      }

      const plansRes = await authedPage.goto('/plans')
      expect(plansRes?.status()).toBe(200)
      await expect(
        authedPage.getByRole('link', { name: /Cadastrar plano|Novo plano/ }),
      ).toHaveAttribute('href', '/plans/new')
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toHaveCount(0)

      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('button', { name: /Exportar CSV/ })).toBeVisible()
    })

    test('billing surface mostra o plano Pro ativo', async ({ authedPage }) => {
      await authedPage.goto('/settings/billing')
      await expect(authedPage.getByText('Plano Pro')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Ajustar plano/ })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeHidden()
    })
  })
})
