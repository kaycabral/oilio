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

import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsDocument, FsValue } from '../helpers/firestore-rest'
import {
  decodeFsDocument,
  decodeFsListResponse,
  parseJson,
  strField,
} from '../helpers/firestore-rest'
import { chooseOptionByIndex } from '../helpers/select'
import {
  seedCustomer,
  seedSubscription,
  seedSubscriptionPlan,
  setActiveUnitCookie,
} from '../helpers/session'

function docUrl(orgId: string, collection: string, docId: string): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/organizations/${orgId}/${collection}/${docId}`
}

function getJson<T>(url: string, decode: (u: unknown) => T): T {
  const out = execFileSync('curl', ['-fsS', url, '-H', 'Authorization: Bearer owner'], {
    stdio: 'pipe',
  }).toString()
  return parseJson(out, decode)
}

type Fields = Record<string, FsValue>
function fieldsOf(doc: FsDocument): Fields {
  return doc.fields ?? {}
}
function str(fields: Fields, key: string): string | undefined {
  return strField(fields, key)
}

function getDoc(orgId: string, collection: string, docId: string): Fields {
  return fieldsOf(getJson(docUrl(orgId, collection, docId), decodeFsDocument))
}
function listDocs(orgId: string, collection: string): Fields[] {
  const base = docUrl(orgId, collection, '').replace(/\/$/, '')
  const docs = getJson(base, decodeFsListResponse).documents ?? []
  return docs.map(fieldsOf)
}

// The `subscription.created` event in the aggregate stream. Its payload is the
// only source of `unitId` — the projection is rebuilt from it (event-first).
function createdEventUnitId(orgId: string, subId: string): string | undefined {
  const base = docUrl(orgId, 'subscriptions', subId).replace(/\/$/, '') + '/events'
  const docs = getJson(base, decodeFsListResponse).documents ?? []
  for (const f of docs.map(fieldsOf)) {
    if (str(f, '_tag') !== 'subscription.created') continue
    const payload = f.payload?.mapValue?.fields
    return payload ? str(payload, 'unitId') : undefined
  }
  return undefined
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
      seedSubscriptionPlan(org.orgId, { name: planLabel })
      seedCustomer(org.orgId)

      await setActiveUnitCookie(authedPage.context(), unitA)
      await authedPage.goto('/subscriptions/new')
      await chooseOptionByIndex(authedPage, 'Cliente', 0)
      await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
      await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
      await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

      const subId = authedPage.url().split('/subscriptions/')[1]!.split(/[/?#]/)[0]!

      // Assinatura criada pelo fluxo real carrega a unidade ativa (AC-01).
      expect(str(getDoc(org.orgId, 'subscriptions', subId), 'unitId')).toBe(unitA)

      // O Charge do ciclo snapshota o MESMO unitId (AC-02).
      const charges = listDocs(org.orgId, 'charges').filter(
        (c) => str(c, 'subscriptionId') === subId,
      )
      expect(charges).toHaveLength(1)
      expect(str(charges[0]!, 'unitId')).toBe(unitA)
    })

    test('Cenário 2: MRR reflete só a unidade ativa', async ({ org, authedPage }) => {
      const unitA = org.unitIds[0]!
      const unitB = org.unitIds[1]!
      const custA = seedCustomer(org.orgId)
      const custB = seedCustomer(org.orgId)
      seedSubscription(org.orgId, custA, {
        unitId: unitA,
        priceCents: 10000,
        status: 'active',
      })
      seedSubscription(org.orgId, custB, {
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
      seedSubscriptionPlan(org.orgId, { name: planLabel })
      seedCustomer(org.orgId)

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
      const eventUnitId = createdEventUnitId(org.orgId, subId)
      const projectedUnitId = str(getDoc(org.orgId, 'subscriptions', subId), 'unitId')
      expect(eventUnitId).toBe(unitA)
      expect(projectedUnitId).toBe(eventUnitId)
    })
  },
)
