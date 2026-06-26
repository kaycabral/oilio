// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md).
// Assinatura é entidade de ciclo de vida (não CRUD simples: sem tela de edição,
// e o término é "cancelar", não "excluir"). O baseline cobre o equivalente:
// - render + empty state
// - criar pelo fluxo real (cliente + plano) → aparece na lista → cancelar
// - dado degenerado: cliente desativado (soft-archive) → lista renderiza sem 500
//
// createSubscription precisa de cliente + plano ATIVO no mesmo org, então
// ambos são semeados via REST antes do fluxo de UI.

import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { chooseOptionByIndex } from '../helpers/select'
import type { SeededOrg } from '../helpers/session'
import {
  pgListByOrg,
  pgReadProjection,
  seedCustomer,
  seedSubscriptionPlan,
} from '../helpers/session'

// Soft-archives the per-org customer behind an active subscription — the
// production "remover cliente" path (`customers.actions#deleteCustomer`): a
// customer with billing footprint is NEVER hard-deleted (the `*_customer_id_fk`
// FKs are RESTRICT, #1220 D2 — correct: you don't drop a customer that has
// charges/subscriptions). The action stamps `deactivatedAt`, dropping the
// customer from active lists while keeping the row resolvable in history. This
// mirrors that end-state directly so the list-render guard is exercised without
// violating the FK.
async function deactivateCustomer(org: SeededOrg, customerId: string): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      'UPDATE customers SET deactivated_at = now() WHERE org_id = $1 AND id = $2',
      [org.orgId, customerId],
    )
  } finally {
    await client.end()
  }
}

function stringColumn(
  row: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = row?.[key]
  return typeof value === 'string' ? value : undefined
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
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    await seedCustomer(org.orgId)

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
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    await seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    const activeUnitId = org.unitIds[0]
    const subscriptionId = authedPage.url().split('/subscriptions/')[1]!.split(/[/?#]/)[0]!

    // Subscription persistida carrega o unitId da unidade ativa (AC-01).
    const subRow = await pgReadProjection(
      'subscriptions',
      `orgs/${org.orgId}/subscriptions/${subscriptionId}`,
    )
    expect(stringColumn(subRow, 'unit_id')).toBe(activeUnitId)

    // O Charge do ciclo snapshota o MESMO unitId (AC-02).
    const charges = (await pgListByOrg('charges', org.orgId)).filter(
      (c) => stringColumn(c, 'subscription_id') === subscriptionId,
    )
    expect(charges).toHaveLength(1)
    expect(stringColumn(charges[0], 'unit_id')).toBe(activeUnitId)
  })

  test('dado degenerado (cliente desativado) renderiza sem 500', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano Sub Degen ${ts}`
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    const customerId = await seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    // Desativa o cliente por baixo da assinatura via o caminho real de remoção
    // (soft-archive — a FK RESTRICT proíbe hard-delete de cliente com cobrança,
    // #1220 D2). A lista de assinaturas deve continuar renderizando sem 500: a
    // assinatura segue listada e a página monta normalmente.
    await deactivateCustomer(org, customerId)
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByText(planLabel, { exact: false })).toBeVisible({ timeout: 5000 })
  })
})
