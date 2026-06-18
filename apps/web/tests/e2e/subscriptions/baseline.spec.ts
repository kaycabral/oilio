// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md).
// Assinatura é entidade de ciclo de vida (não CRUD simples: sem tela de edição,
// e o término é "cancelar", não "excluir"). O baseline cobre o equivalente:
// - render + empty state
// - criar pelo fluxo real (cliente + plano) → aparece na lista → cancelar
// - dado degenerado: cliente removido → lista renderiza "Cliente removido"
//
// createSubscription precisa de cliente + plano ATIVO no mesmo org, então
// ambos são semeados via REST antes do fluxo de UI.

import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsValue } from '../helpers/firestore-rest'
import {
  decodeFsDocument,
  decodeFsListResponse,
  parseJson,
  strField,
} from '../helpers/firestore-rest'
import { rowAction } from '../helpers/list'
import { chooseOptionByIndex } from '../helpers/select'
import type { SeededOrg } from '../helpers/session'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

function docUrl(orgId: string, collection: string, docId: string): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgs/${orgId}/${collection}/${docId}`
}

function getDoc(orgId: string, collection: string, docId: string): Record<string, FsValue> {
  const out = execFileSync(
    'curl',
    ['-fsS', docUrl(orgId, collection, docId), '-H', 'Authorization: Bearer owner'],
    { stdio: 'pipe' },
  ).toString()
  return parseJson(out, decodeFsDocument).fields ?? {}
}

function listDocs(orgId: string, collection: string): Array<Record<string, FsValue>> {
  const base = docUrl(orgId, collection, '').replace(/\/$/, '')
  const out = execFileSync('curl', ['-fsS', base, '-H', 'Authorization: Bearer owner'], {
    stdio: 'pipe',
  }).toString()
  const docs = parseJson(out, decodeFsListResponse).documents ?? []
  return docs.map((d) => d.fields ?? {})
}

function stringField(fields: Record<string, FsValue>, key: string): string | undefined {
  return strField(fields, key)
}

function deleteCustomer(org: SeededOrg, customerId: string): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'DELETE',
      docUrl(org.orgId, 'customers', customerId),
      '-H',
      'Authorization: Bearer owner',
    ],
    { stdio: 'pipe' },
  )
}

test.describe('Subscriptions — baseline (#17)', { tag: '@critical' }, () => {
  test('render + empty state', async ({ authedPage }) => {
    // No subscriptions at all → protagonist empty-state (brief 0034 / #1072):
    // the EmptyState takes over and the page heading is hidden.
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeHidden()
  })

  test('criar pelo fluxo real → listar → cancelar', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano Sub ${ts}`
    seedSubscriptionPlan(org.orgId, { name: planLabel })
    seedCustomer(org.orgId)

    // Criar — cliente selecionado; plano/ciclo/início já vêm preenchidos.
    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    // Aparece na lista (aba aberta — status pending).
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText(planLabel)).toBeVisible({ timeout: 5000 })

    // Cancelar = SUAVE (ao fim do ciclo): marca cancelAtPeriodEnd, status segue
    // ativo, e a UI (após o router.refresh do run()) passa a oferecer "Cancelar
    // cancelamento" — confirmação in-place, sem reload. A linha do `List` não é
    // mais um link de corpo inteiro; navega-se pelo ⋯ → "Ver detalhes".
    await rowAction(authedPage, planLabel, 'Ver detalhes')
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await authedPage.getByRole('button', { name: 'Cancelar assinatura' }).click()
    await expect(authedPage.getByRole('button', { name: 'Cancelar cancelamento' })).toBeVisible({
      timeout: 10000,
    })
  })

  // Brief 0043 (contexto de unidade único) — Cenário 1 do DoD: a assinatura
  // nasce na unidade ativa e o Charge do ciclo snapshota o mesmo unitId.
  test('assinatura + cobrança nascem na unidade ativa (#1117)', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano Sub Unit ${ts}`
    seedSubscriptionPlan(org.orgId, { name: planLabel })
    seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    const activeUnitId = org.unitIds[0]!
    const subscriptionId = authedPage.url().split('/subscriptions/')[1]!.split(/[/?#]/)[0]!

    // Subscription persistida carrega o unitId da unidade ativa (AC-01).
    const subFields = getDoc(org.orgId, 'subscriptions', subscriptionId)
    expect(stringField(subFields, 'unitId')).toBe(activeUnitId)

    // O Charge do ciclo snapshota o MESMO unitId (AC-02).
    const charges = listDocs(org.orgId, 'charges').filter(
      (c) => stringField(c, 'subscriptionId') === subscriptionId,
    )
    expect(charges).toHaveLength(1)
    expect(stringField(charges[0]!, 'unitId')).toBe(activeUnitId)
  })

  test('dado degenerado (cliente removido) renderiza sem 500', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano Sub Degen ${ts}`
    seedSubscriptionPlan(org.orgId, { name: planLabel })
    const customerId = seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    // Remove o cliente por baixo da assinatura — a lista deve degradar pra
    // "Cliente removido" (guard explícito), nunca 500.
    deleteCustomer(org, customerId)
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByText('Cliente removido')).toBeVisible({ timeout: 5000 })
  })
})
