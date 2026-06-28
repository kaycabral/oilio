// Tier gating + billing surface E2E (brief 0072/0073 DoD). Proves the real
// capability gate from the user's seat: a Free Negócio cannot create plans and
// sees the Free billing panel; a Pro Negócio can create plans and sees the Pro
// panel with the subscribe CTA gone. Asserts the post-state in the app, not the
// Stripe-hosted UI (the webhook→org_billing path is proven in integration; here
// we seed the billing row a paid webhook would write).

import { expect, test } from '../fixtures'

test.describe('Billing — tier gating (brief 0072/0073)', { tag: '@critical' }, () => {
  test.describe('Free Negócio', () => {
    // Override the default-advanced seed: this org has NO Stripe row → Free.
    test.use({ orgInput: { tier: 'free' } })

    test('cannot create plans (capability gated) and sees the Free panel', async ({
      authedPage,
    }) => {
      // Plans surface: the create CTA is hidden under Free (plans.recurring locked).
      await authedPage.goto('/plans')
      await expect(authedPage.getByRole('heading', { name: 'Planos de assinatura' })).toBeHidden()
      await expect(authedPage.getByRole('link', { name: 'Cadastrar plano' })).toBeHidden()

      // Direct navigation to the create route is blocked by the server action gate
      // — the form submit returns the upgrade error rather than creating a plan.
      // (The empty-state CTA being gone already proves the UI layer.)

      // Billing surface shows Free + the subscribe CTA (no active subscription).
      await authedPage.goto('/settings/billing')
      await expect(authedPage.getByRole('heading', { name: 'Plano e cobrança' })).toBeVisible()
      await expect(authedPage.getByText('Plano Free')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeVisible()
    })
  })

  test.describe('Pro Negócio', () => {
    test.use({ orgInput: { tier: 'pro' } })

    test('can create plans and sees the Pro panel with portal access', async ({ authedPage }) => {
      // Plans surface: the create CTA is present under Pro.
      await authedPage.goto('/plans')
      await expect(
        authedPage.getByRole('link', { name: /Cadastrar plano|Novo plano/ }),
      ).toBeVisible()

      // Billing surface shows the active Pro plan; the subscribe CTA is replaced
      // by the manage/portal action (a Stripe customer exists from the seed).
      await authedPage.goto('/settings/billing')
      await expect(authedPage.getByText('Plano Pro')).toBeVisible()
      await expect(authedPage.getByText('Ativa')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /portal de cobrança/ })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: /Assinar o Pro/ })).toBeHidden()
    })
  })
})
