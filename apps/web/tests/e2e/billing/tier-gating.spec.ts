// Tier gating E2E (brief 0088 DoD — B1/B2/C1). Reverses the CTA-in-place posture
// (0082 deprecated): off-plan surfaces DISAPPEAR from the nav and off-plan routes
// behave like routes that don't exist (404) — no locked screen, no upgrade CTA
// (upsell lives only in /settings/billing + /pricing). A Free Negócio 404s on
// every gated route and its nav hides them; a Pro Negócio uses everything
// normally. The billing surface moved to /settings/billing (brief 0090) and its
// heading is now "Cobrança". The server-side mutation wall (A1/A3) is proven in
// the action/integration tests; here we assert the user-facing hide-and-404 from
// the seat. We seed the billing row a paid webhook would write (webhook→
// org_billing proven in integration).

import { expect, test } from '../fixtures'

// Every surface gated by a billing capability — hidden from nav + 404 on direct
// URL for a Free org (brief 0088 B2/B1).
const GATED_ROUTES = [
  '/plans',
  '/plans/new',
  '/subscriptions',
  '/subscriptions/new',
  '/copilot',
  '/reports',
] as const

// The nav labels that must vanish for a Free org.
const GATED_NAV_LABELS = ['Planos', 'Assinaturas', 'Relatórios', 'Copiloto'] as const

test.describe('Billing — tier gating (brief 0088)', { tag: '@critical' }, () => {
  test.describe('Free Negócio — off-plan surfaces hidden + 404', () => {
    // No Stripe row → Free (default-advanced seed overridden).
    test.use({ orgInput: { tier: 'free' } })

    for (const route of GATED_ROUTES) {
      test(`${route} responde 404 no acesso direto (B1)`, async ({ authedPage }) => {
        const res = await authedPage.goto(route)
        expect(res?.status()).toBe(404)
        // No upgrade CTA on the 404 — upsell lives only in /settings/billing + /pricing.
        await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toHaveCount(0)
      })
    }

    test('a nav esconde toda superfície fora do plano (B2)', async ({ authedPage }) => {
      await authedPage.goto('/agenda')
      for (const label of GATED_NAV_LABELS) {
        await expect(authedPage.getByRole('link', { name: label })).toHaveCount(0)
      }
      // Baseline Free operation stays reachable.
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

      // Plans opens (no 404, no upgrade CTA), with the create affordance. On a
      // Pro org with no plans yet the list renders its empty state, whose CTA is
      // the "Cadastrar plano" link (the header "Novo plano" button only shows
      // once the list is populated) — both point at /plans/new and both are
      // gated by the same tier+role check, so asserting the create link by its
      // href proves the Pro create affordance regardless of list population.
      const plansRes = await authedPage.goto('/plans')
      expect(plansRes?.status()).toBe(200)
      await expect(
        authedPage.getByRole('link', { name: /Cadastrar plano|Novo plano/ }),
      ).toHaveAttribute('href', '/plans/new')
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toHaveCount(0)

      // Reports render the real sections + the CSV export.
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('button', { name: /Exportar CSV/ })).toBeVisible()
    })

    test('billing surface mostra o plano Pro ativo', async ({ authedPage }) => {
      await authedPage.goto('/settings/billing')
      await expect(authedPage.getByText('Plano Pro')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /portal de cobrança/ })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeHidden()
    })
  })
})
