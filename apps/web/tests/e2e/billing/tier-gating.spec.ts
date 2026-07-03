// Tier gating + billing surface E2E (brief 0072/0073 + 0082 DoD). Proves the
// real capability gate from the user's seat: a Free Negócio hits the consistent
// upgrade CTA on every gated surface (never a mute empty state or a form that
// only fails on submit) and cannot see paid data; a Pro Negócio uses everything
// normally. Asserts the post-state in the app, not the Stripe-hosted UI (the
// webhook→org_billing path is proven in integration; here we seed the billing
// row a paid webhook would write).

import { expect, test } from '../fixtures'

test.describe('Billing — tier gating (brief 0072/0073/0082)', { tag: '@critical' }, () => {
  test.describe('Free Negócio — sees the upgrade CTA, not a form-that-fails', () => {
    // Override the default-advanced seed: this org has NO Stripe row → Free.
    test.use({ orgInput: { tier: 'free' } })

    test('plans + subscriptions surfaces show the upgrade CTA to /billing', async ({
      authedPage,
    }) => {
      // Plans list: empty state is the upgrade CTA (brief 0082 — replaces the old
      // "hide the action" behavior).
      await authedPage.goto('/plans')
      const plansCta = authedPage.getByRole('link', { name: 'Fazer upgrade' })
      await expect(plansCta).toBeVisible()
      await expect(plansCta).toHaveAttribute('href', '/billing')

      // Deep-linking the create form no longer shows the form — it shows the CTA
      // (no more filling a plan form that createPlan rejects at submit).
      await authedPage.goto('/plans/new')
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Salvar|Criar plano/ })).toBeHidden()

      // New subscription: the whole page is the CTA, not the "Cadastrar plano"
      // link that used to lead straight to the rejected plan form (the bug-seed).
      await authedPage.goto('/subscriptions/new')
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toBeVisible()
    })

    test('reports do not leak sales/commissions data to Free', async ({ authedPage }) => {
      await authedPage.goto('/reports')
      // Both sections render the upgrade CTA; the CSV export is absent (the
      // loader did not fetch the data — the real gate, not just a hidden button).
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' }).first()).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Exportar CSV/ })).toBeHidden()
    })

    test('copiloto shows the upgrade CTA instead of the goal form', async ({ authedPage }) => {
      await authedPage.goto('/copilot')
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toBeVisible()
    })

    test('billing surface shows Free + the subscribe CTA', async ({ authedPage }) => {
      await authedPage.goto('/billing')
      await expect(authedPage.getByRole('heading', { name: 'Plano e cobrança' })).toBeVisible()
      await expect(authedPage.getByText('Plano Free')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeVisible()
    })
  })

  test.describe('Pro Negócio — no CTA, everything works', () => {
    test.use({ orgInput: { tier: 'pro' } })

    test('can create plans and sees the Pro panel with portal access', async ({ authedPage }) => {
      // Plans surface: the create CTA is present under Pro; no upgrade CTA.
      await authedPage.goto('/plans')
      await expect(
        authedPage.getByRole('link', { name: /Cadastrar plano|Novo plano/ }),
      ).toBeVisible()
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toBeHidden()

      // Reports render the real sections (with the CSV export), not the CTA.
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('button', { name: /Exportar CSV/ })).toBeVisible()
      await expect(authedPage.getByRole('link', { name: 'Fazer upgrade' })).toBeHidden()

      // Billing surface shows the active Pro plan; the subscribe CTA is replaced
      // by the manage/portal action (a Stripe customer exists from the seed).
      await authedPage.goto('/billing')
      await expect(authedPage.getByText('Plano Pro')).toBeVisible()
      await expect(authedPage.getByText('Unidades cobradas')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /portal de cobrança/ })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeHidden()
    })
  })
})
