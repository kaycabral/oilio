import { expect, test } from '../fixtures'
import { seedCustomer, seedSubscription } from '../helpers/session'

// E2E spec — subscription charge-flow beyond the happy path (brief 0065 § Grupo
// B, AC-02 + AC-03). `markChargePaid` already has e2e coverage
// (`commissions/mark-paid.spec.ts`); the two remaining legs did not:
//   - renewSubscription: renewing an active subscription mints a NEW `scheduled`
//     charge (the next cycle).
//   - markChargeFailed: failing that charge moves it off `scheduled` (below the
//     threshold it goes `recovering`).
// Both run a cross-aggregate ACID saga server-side; here we drive them through
// the real `/subscriptions/[id]` UI (SubscriptionDetail) the manager uses.

test.describe('subscription charge-flow (não-happy)', () => {
  test.use({ orgInput: { professionalCount: 0 } })

  test('renovar gera nova cobrança Agendada; marcar falha tira do Agendada', async ({
    org,
    authedPage,
  }) => {
    const custId = await seedCustomer(org.orgId, { name: `Cliente ${Date.now()}` })
    const subId = await seedSubscription(org.orgId, custId, {
      planName: 'Plano Mensal',
      priceCents: 9900,
      status: 'active',
    })

    await authedPage.goto(`/subscriptions/${subId}`)

    // Scope assertions to the charge ROW (listitem in the "Cobranças" section),
    // never the subscription status badge in the header — both `charge.recovering`
    // and `subscription.past_due` render the label "Em recuperação".

    // ── AC-03: renewSubscription → a new `scheduled` ("Agendada") charge row. ──
    await authedPage.getByRole('button', { name: 'Renovar agora' }).click()
    const chargeRow = authedPage.getByRole('listitem').filter({ hasText: 'Agendada' })
    await expect(chargeRow).toBeVisible({ timeout: 5000 })

    // ── AC-02: markChargeFailed on that charge. The button prompts for a reason
    //    via window.prompt — auto-accept it. Below the failure threshold the
    //    charge moves to `recovering` ("Em recuperação"), off `scheduled`. ──
    authedPage.on('dialog', (dialog) => dialog.accept('card_declined'))
    await chargeRow.getByRole('button', { name: 'Marcar falha' }).click()

    // The SAME charge row now reads recovering and is no longer scheduled — the
    // assertion lives inside the list item, so it can't be satisfied by the
    // subscription header badge.
    const recoveringRow = authedPage.getByRole('listitem').filter({ hasText: 'Em recuperação' })
    await expect(recoveringRow).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByRole('listitem').filter({ hasText: 'Agendada' })).toHaveCount(0)
  })
})
