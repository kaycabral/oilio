import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { pgReadEventStream, seedCustomer, seedSubscription } from '../helpers/session'

const EventEnvelopeSchema = Schema.Struct({ _tag: Schema.optional(Schema.String) })
const decodeEventStream = Schema.decodeUnknownSync(Schema.Array(EventEnvelopeSchema))

async function listEventTags(orgId: string, subscriptionId: string): Promise<string[]> {
  const stream = await pgReadEventStream(aggregateRef(SubscriptionConfig, orgId, subscriptionId))
  return decodeEventStream(stream).map((e) => e._tag ?? '')
}

test.describe('/me/subscriptions — customer self-cancel (#651)', { tag: '@critical' }, () => {
  test('AC-11/12: customer cancela mid-cycle → cancelAtPeriodEnd + evento', async ({
    org,
    authedPage,
  }) => {
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Self',
      email: org.email,
      userId: org.uid,
    })
    const subscriptionId = await seedSubscription(org.orgId, customerId, {
      planName: 'Mensal Self',
      priceCents: 7000,
    })

    await authedPage.goto('/me/subscriptions')

    await expect(authedPage.getByText(/Mensal Self/)).toBeVisible()
    const cancelBtn = authedPage.getByRole('button', { name: /Cancelar assinatura/ })
    await expect(cancelBtn).toBeVisible()

    await cancelBtn.click()

    await expect(
      authedPage.getByText(/Cancelamento solicitado.*encerra ao fim do ciclo/),
    ).toBeVisible()

    const tags = await listEventTags(org.orgId, subscriptionId)
    expect(tags, 'evento subscription.cancel_scheduled deve existir').toContain(
      'subscription.cancel_scheduled',
    )
  })
})
