// E2E spec — sub-issue #651 do brief 0003.
//
// Cobre AC-11 (smoke): cliente acessa /me/subscriptions e cancela
// self-service. AC-12: cancelAtPeriodEnd=true.
//
// Auditoria = stream (brief 0025, #1029): o self-cancel não grava mais
// `recordAudit('subscription.cancel')` — o registro canônico é o evento
// `subscription.cancel_scheduled` no event store do aggregate.

import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { pgReadEventStream, seedCustomer, seedSubscription } from '../helpers/session'

// Lenient envelope schema — só o `_tag` é assertado; campos extras do envelope
// (version/timestamp/actorId/payload) são ignorados pelo decode.
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
    // O `authedPage` está autenticado com org.uid — vamos seedar um Customer
    // ligado a esse uid pra simular a relação User canonical → Customer per-org.
    // Customer ligado ao User logado (authedPage usa org.uid).
    // Sem isso, customerUserId !== session.uid e /me/subscriptions vem vazio.
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

    // Estado inicial: subscription visível com botão Cancelar
    await expect(authedPage.getByText(/Mensal Self/)).toBeVisible()
    const cancelBtn = authedPage.getByRole('button', { name: /Cancelar assinatura/ })
    await expect(cancelBtn).toBeVisible()

    await cancelBtn.click()

    // Status muda pra "cancelamento solicitado"
    await expect(
      authedPage.getByText(/Cancelamento solicitado.*encerra ao fim do ciclo/),
    ).toBeVisible()

    // Auditoria = stream: o cancelamento é registrado pelo evento
    // `subscription.cancel_scheduled` no event store (não mais audit_logs).
    // A projeção `cancelAtPeriodEnd` (que o UI mostra acima) deriva dele.
    const tags = await listEventTags(org.orgId, subscriptionId)
    expect(tags, 'evento subscription.cancel_scheduled deve existir').toContain(
      'subscription.cancel_scheduled',
    )
  })
})
