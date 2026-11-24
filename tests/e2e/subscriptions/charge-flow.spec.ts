import { expect, test } from '../fixtures'
import { seedCustomer, seedSubscription } from '../helpers/session'

test.describe('subscription charge-flow (não-happy)', () => {
  test.use({ orgInput: { memberOperationCount: 0 } })

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

    await authedPage.getByRole('button', { name: 'Renovar agora' }).click()
    const chargeRow = authedPage.getByRole('listitem').filter({ hasText: 'Agendada' })
    await expect(chargeRow).toBeVisible({ timeout: 5000 })

    authedPage.on('dialog', (dialog) => dialog.accept('card_declined'))
    await chargeRow.getByRole('button', { name: 'Marcar falha' }).click()

    const recoveringRow = authedPage.getByRole('listitem').filter({ hasText: 'Em recuperação' })
    await expect(recoveringRow).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByRole('listitem').filter({ hasText: 'Agendada' })).toHaveCount(0)
  })
})
