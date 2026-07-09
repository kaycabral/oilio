import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
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
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeHidden()
  })

  test('criar pelo fluxo real → listar → cancelar', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano Sub ${ts}`
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    await seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText(planLabel)).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, planLabel, 'Ver detalhes')
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await authedPage.getByRole('button', { name: 'Cancelar assinatura' }).click()
    await expect(authedPage.getByRole('button', { name: 'Cancelar cancelamento' })).toBeVisible({
      timeout: 10000,
    })
  })

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

    const subRow = await pgReadProjection(
      'subscriptions',
      aggregateRef(SubscriptionConfig, org.orgId, subscriptionId),
    )
    expect(stringColumn(subRow, 'unit_id')).toBe(activeUnitId)

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

    await deactivateCustomer(org, customerId)
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByText(planLabel, { exact: false })).toBeVisible({ timeout: 5000 })
  })
})
