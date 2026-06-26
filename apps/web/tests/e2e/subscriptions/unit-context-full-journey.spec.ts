// Feature-level E2E — brief 0043 (assinatura por unidade), parent #1116.
//
// Valida o § Definition of Done do brief — princípio canônico #11 (DoD é
// contrato) + #15 (parent issue tem sua PR Feature-level). As sub-issues
// #1117 (modelo) e #1118 (leitura) já passaram em E2Es próprios; este spec
// cruza os componentes (criação → persistência → dashboard → stream de eventos)
// pra pegar bugs de integração que os granulares não detectam.
//
// Cenários canonicamente declarados em
// [brief § DoD](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0043-assinatura-por-unidade):
//   - Cenário 1 [critical]: assinatura nasce na unidade ativa (sub + charge)
//   - Cenário 2 [critical]: MRR reflete só a unidade ativa
//   - Cenário 3 [critical]: replay reconstrói o unitId (event-first)

import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import {
  pgQueryProjection,
  pgReadEventStream,
  pgReadProjection,
  seedCustomer,
  seedSubscription,
  seedSubscriptionPlan,
  setActiveUnitCookie,
} from '../helpers/session'

// The `subscription.created` event envelope as returned by `pgReadEventStream`:
// the event body lives flat under `payload` ({ _tag, ...payload }), so `unitId`
// is read off `payload.unitId`. Lenient struct — only the sub-fields the assert
// touches are described; the richer real envelope decodes fine.
const EventEnvelope = Schema.Struct({
  _tag: Schema.String,
  payload: Schema.Struct({ unitId: Schema.optional(Schema.String) }),
})
const decodeEvent = Schema.decodeUnknownSync(EventEnvelope)

// The projection's `unit_id` is the only source of `unitId` — the projection is
// rebuilt from the `subscription.created` event payload (event-first).
async function createdEventUnitId(orgId: string, subId: string): Promise<string | undefined> {
  const stream = await pgReadEventStream(aggregateRef(SubscriptionConfig, orgId, subId))
  for (const raw of stream) {
    const event = decodeEvent(raw)
    if (event._tag !== 'subscription.created') continue
    return event.payload.unitId
  }
  return undefined
}

// Reads the persisted subscription projection's `unit_id` (snake_case Postgres
// column), or undefined when the row/column is absent.
async function projectedUnitId(orgId: string, subId: string): Promise<string | undefined> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  const unitId = row?.unit_id
  return typeof unitId === 'string' ? unitId : undefined
}

function mrrValue(page: Page) {
  return page.getByText('MRR', { exact: true }).locator('xpath=following-sibling::*[1]')
}

test.describe(
  'brief 0043 — Feature-level DoD (assinatura por unidade)',
  { tag: ['@critical', '@journey'] },
  () => {
    test.use({ orgInput: { unitCount: 2, hasBusinessHours: true } })

    test('Cenário 1: assinatura nasce na unidade ativa (sub + charge)', async ({
      org,
      authedPage,
    }) => {
      const unitA = org.unitIds[0]!
      const planLabel = `Plano DoD ${Date.now()}`
      await seedSubscriptionPlan(org.orgId, { name: planLabel })
      await seedCustomer(org.orgId)

      await setActiveUnitCookie(authedPage.context(), unitA)
      await authedPage.goto('/subscriptions/new')
      await chooseOptionByIndex(authedPage, 'Cliente', 0)
      await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
      await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
      await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

      const subId = authedPage.url().split('/subscriptions/')[1]!.split(/[/?#]/)[0]!

      // Assinatura criada pelo fluxo real carrega a unidade ativa (AC-01).
      expect(await projectedUnitId(org.orgId, subId)).toBe(unitA)

      // O Charge do ciclo snapshota o MESMO unitId (AC-02).
      const charges = await pgQueryProjection('charges', 'subscription_id', subId)
      expect(charges).toHaveLength(1)
      expect(charges[0]!.unit_id).toBe(unitA)
    })

    test('Cenário 2: MRR reflete só a unidade ativa', async ({ org, authedPage }) => {
      const unitA = org.unitIds[0]!
      const unitB = org.unitIds[1]!
      const custA = await seedCustomer(org.orgId)
      const custB = await seedCustomer(org.orgId)
      await seedSubscription(org.orgId, custA, {
        unitId: unitA,
        priceCents: 10000,
        status: 'active',
      })
      await seedSubscription(org.orgId, custB, {
        unitId: unitB,
        priceCents: 30000,
        status: 'active',
      })

      await setActiveUnitCookie(authedPage.context(), unitA)
      await authedPage.goto('/dashboard')
      await expect(mrrValue(authedPage)).toHaveText('R$ 100,00')

      await setActiveUnitCookie(authedPage.context(), unitB)
      await authedPage.goto('/dashboard')
      await expect(mrrValue(authedPage)).toHaveText('R$ 300,00')
    })

    test('Cenário 3: a projeção do unitId deriva do evento (event-first)', async ({
      org,
      authedPage,
    }) => {
      const unitA = org.unitIds[0]!
      const planLabel = `Plano DoD ES ${Date.now()}`
      await seedSubscriptionPlan(org.orgId, { name: planLabel })
      await seedCustomer(org.orgId)

      await setActiveUnitCookie(authedPage.context(), unitA)
      await authedPage.goto('/subscriptions/new')
      await chooseOptionByIndex(authedPage, 'Cliente', 0)
      await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
      await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
      await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

      const subId = authedPage.url().split('/subscriptions/')[1]!.split(/[/?#]/)[0]!

      // Event-first: o `subscription.created` carrega o unitId, e a projeção
      // (doc operacional) é idêntica a ele — provando que o estado reconstrói a
      // partir do stream. (A igualdade campo-a-campo do replayAggregate é o teste
      // de domínio `subscription/reducer` + `charge-replay`.)
      const eventUnitId = await createdEventUnitId(org.orgId, subId)
      const projected = await projectedUnitId(org.orgId, subId)
      expect(eventUnitId).toBe(unitA)
      expect(projected).toBe(eventUnitId)
    })
  },
)
