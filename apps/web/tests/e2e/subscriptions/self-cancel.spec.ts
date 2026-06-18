// E2E spec — sub-issue #651 do brief 0003.
//
// Cobre AC-11 (smoke): cliente acessa /me/subscriptions e cancela
// self-service. AC-12: cancelAtPeriodEnd=true.
//
// Auditoria = stream (brief 0025, #1029): o self-cancel não grava mais
// `recordAudit('subscription.cancel')` — o registro canônico é o evento
// `subscription.cancel_scheduled` na subcollection `events/` do aggregate.

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { parseJson } from '../helpers/firestore-rest'
import { seedCustomer, seedSubscription } from '../helpers/session'

const EventTagListSchema = Schema.Struct({
  documents: Schema.optional(
    Schema.Array(
      Schema.Struct({
        fields: Schema.optional(
          Schema.Record({
            key: Schema.String,
            value: Schema.Struct({ stringValue: Schema.optional(Schema.String) }),
          }),
        ),
      }),
    ),
  ),
})
const decodeEventTagList = Schema.decodeUnknownSync(EventTagListSchema)

function listEventTags(orgId: string, subscriptionId: string): string[] {
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgs/${orgId}/subscriptions/${subscriptionId}/events`
  const out = execFileSync('curl', ['-fsS', url, '-H', 'Authorization: Bearer owner'], {
    encoding: 'utf8',
  })
  const data = parseJson(out, decodeEventTagList)
  return (data.documents ?? []).map((d) => d.fields?._tag?.stringValue ?? '')
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
    const customerId = seedCustomer(org.orgId, {
      name: 'Cliente Self',
      email: org.email,
      userId: org.uid,
    })
    const subscriptionId = seedSubscription(org.orgId, customerId, {
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
    const tags = listEventTags(org.orgId, subscriptionId)
    expect(tags, 'evento subscription.cancel_scheduled deve existir').toContain(
      'subscription.cancel_scheduled',
    )
  })
})
