import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

// Native cancellation E2E (brief 0090, AC-09 / DoD cenário 4). The owner cancels
// the Assinatura Oilio in-app (no Stripe portal) via the destructive AlertDialog
// on the Cobrança section. Here we drive the UI up to the confirm dialog and its
// preserve-access copy, plus the owner-only gate; the actual
// `stripe.subscriptions.update` + org_billing projection are proven without the
// live gateway (cancel.actions unit test + the webhook integration test), so this
// spec never posts to Stripe.

test.describe('Cobrança — cancelamento nativo (brief 0090)', { tag: '@critical' }, () => {
  test.describe('owner com assinatura paga', () => {
    test.use({ orgInput: { tier: 'pro' } })

    test('vê a zona de cancelamento e o dialog destrutivo com a copy de retenção', async ({
      authedPage,
    }) => {
      await authedPage.goto('/settings/billing')

      // The cancellation zone shows for an owner on a live paid subscription.
      // "Cancelamento" is a Typography heading-styled label, not an <h*> role.
      await expect(authedPage.getByText('Cancelamento', { exact: true })).toBeVisible()
      await authedPage.getByRole('button', { name: 'Cancelar plano' }).click()

      // The destructive dialog preserves access until the period end + offers the
      // retention escape and the destructive confirm.
      const dialog = authedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(/Você ainda poderá usar o Plano Pro/)
      await expect(dialog).toContainText(/Você perderá acesso a/)
      await expect(dialog.getByRole('button', { name: 'Manter meu Plano Pro' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Cancelar plano' })).toBeVisible()

      // The retention button closes the dialog without canceling (escape hatch).
      await dialog.getByRole('button', { name: 'Manter meu Plano Pro' }).click()
      await expect(authedPage.getByRole('alertdialog')).toHaveCount(0)
    })
  })

  test('não-owner (manager) não vê a ação de cancelamento', async ({ authedPage, org }) => {
    // Manager reaches the read-only billing view; the mutating actions (portal,
    // cancel) are owner-only. Seed a paid tier so the panel isn't the Free layout.
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'manager')

    await authedPage.goto('/settings/billing')
    await expect(authedPage.getByRole('heading', { name: 'Cobrança' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Cancelamento' })).toHaveCount(0)
    await expect(authedPage.getByRole('button', { name: 'Cancelar plano' })).toHaveCount(0)
  })
})
