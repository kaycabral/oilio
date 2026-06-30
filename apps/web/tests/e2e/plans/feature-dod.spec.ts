// Feature-level E2E — brief 0024 § Definition of Done (parent #1007).
//
// 1 test por cenário do DoD, validando o contrato da feature "Cobertura de
// plano = pacote de itens granulares" como gate do parent (cross-component, não
// das sub-issues #1008 modelo+form · #1009 consumo):
// - Cenário 1: plano cobre itens granulares (serviço e produto) [critical]
// - Cenário 2: consumo resolve em granular, por kind [critical]
// - Cenário 3: catálogo sem combo opaco (invariante) [critical]
//
// Roda contra emulator + dev. Reusa os fluxos provados nas specs das fatias.

import { CatalogItemConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { addCatalogItemToOrder } from '../helpers/orders'
import {
  pgQueryProjection,
  pgReadProjection,
  seedAppointment,
  seedCatalogItem,
  seedCategory,
  seedCustomer,
  seedSubscription,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// The subscription `current_period` JSONB column carries the camelCase domain
// shape; only `consumed` is asserted here. Lenient struct ignores the rest.
const CurrentPeriod = Schema.Struct({ consumed: Schema.optional(Schema.Number) })
const decodeCurrentPeriod = Schema.decodeUnknownSync(CurrentPeriod)

async function readConsumed(orgId: string, subId: string): Promise<number> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  if (!row) return 0
  return decodeCurrentPeriod(row.current_period).consumed ?? 0
}

async function readStock(orgId: string, itemId: string): Promise<number> {
  const row = await pgReadProjection(
    'catalog_items',
    aggregateRef(CatalogItemConfig, orgId, itemId),
  )
  const stock = row?.stock
  return typeof stock === 'number' ? stock : Number(stock ?? '0')
}

async function countOrderCommissions(orgId: string, orderId: string): Promise<number> {
  const rows = await pgQueryProjection('commissions', 'order_id', orderId)
  return rows.filter((r) => r.org_id === orgId).length
}

async function confirmClose(authedPage: Page): Promise<void> {
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Feature 0024 — Definition of Done (cobertura por itens granulares)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: plano cobre itens granulares (serviço e produto)', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const serviceName = `Barba ${ts}`
    const productName = `Pomada ${ts}`
    await seedCatalogItem(org.orgId, { kind: 'service', name: serviceName })
    await seedCatalogItem(org.orgId, { kind: 'product', name: productName })
    const name = `Plano DoD ${ts}`
    // Coverage checkboxes are labeled by the item name + kind suffix.
    const serviceItem = authedPage.getByRole('checkbox', { name: new RegExp(serviceName) })
    const productItem = authedPage.getByRole('checkbox', { name: new RegExp(productName) })

    // Cobertura selecionada como ITENS (serviço + produto) pelo picker real.
    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('120,00')
    await authedPage.locator('input[name="limitQuantity"]').fill('4')
    await serviceItem.check()
    await productItem.check()
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    // Persiste como includedItemIds (qualquer kind): reabrir mostra ambos marcados.
    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(serviceItem).toBeChecked()
    await expect(productItem).toBeChecked()
  })

  test('Cenário 2: consumo resolve em granular, por kind', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const unitId = org.unitIds[0]!
    const productCategoryId = await seedCategory(org.orgId, { name: `Produtos ${ts}` })
    const serviceId = await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Barba ${ts}`,
      priceCents: 4000,
      durationMinutes: 30,
      unitIds: [unitId],
      commission: { kind: 'percentage', value: 50 },
    })
    const productId = await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: `Pomada ${ts}`,
      priceCents: 1500,
      categoryId: productCategoryId,
      unitIds: [unitId],
      stock: 10,
    })
    const customerId = await seedCustomer(org.orgId, {
      name: `Cliente DoD ${ts}`,
      whatsapp: `1199${ts.slice(-7)}`,
    })
    // Snapshot congelado: serviço coberto por item, produto por categoria.
    const subId = await seedSubscription(org.orgId, customerId, {
      planName: 'Granular DoD',
      usageLimit: { kind: 'count', quantity: 4 },
      includedItemIds: [serviceId],
      includedCategoryIds: [productCategoryId],
    })
    await seedAppointment({
      orgId: org.orgId,
      unitId,
      memberOperationId: org.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt: '2026-09-08T17:00:00.000Z',
      endAt: '2026-09-08T17:30:00.000Z',
      status: 'scheduled',
      servicePriceCentsSnapshot: 4000,
      serviceDurationMinutesSnapshot: 30,
      commissionSnapshot: { kind: 'percentage', value: 50 },
    })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: new RegExp(`Cliente DoD ${ts}`) }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    const orderId = authedPage.url().split('/orders/')[1]!.split(/[?#]/)[0]!

    // Serviço coberto já auto-marca na abertura (brief 0079 AC-06).
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: `Barba ${ts}` })
        .getByRole('combobox', { name: 'Cobertura do item' }),
    ).toHaveText('Consumo do plano')
    // Produto coberto (via categoria) também auto-marca ao ser adicionado (AC-09).
    await addCatalogItemToOrder(authedPage, `Pomada ${ts}`)
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: `Pomada ${ts}` })
        .getByRole('combobox', { name: 'Cobertura do item' }),
    ).toHaveText('Consumo do plano')

    await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
    await confirmClose(authedPage)

    // Resolução granular por kind: cota debita 2 (serviço+produto); serviço
    // coberto não gera comissão; produto coberto baixa estoque (10−1).
    expect(await readConsumed(org.orgId, subId)).toBe(2)
    expect(await countOrderCommissions(org.orgId, orderId)).toBe(0)
    expect(await readStock(org.orgId, productId)).toBe(9)
  })

  test('Cenário 3: catálogo sem combo opaco (invariante)', async ({ authedPage }) => {
    // O item do catálogo é sempre granular: o seletor de tipo oferece apenas
    // Serviço e Produto — não há "combo"/"pacote" (pacote = cobertura do plano).
    await authedPage.goto('/catalog/new')
    const kindGroup = authedPage.getByRole('radiogroup', { name: 'Tipo do item' })
    await expect(kindGroup).toBeVisible()
    await expect(kindGroup.getByRole('radio', { name: 'Serviço' })).toBeVisible()
    await expect(kindGroup.getByRole('radio', { name: 'Produto' })).toBeVisible()
    await expect(kindGroup.getByRole('radio')).toHaveCount(2)
    await expect(kindGroup.getByRole('radio', { name: /combo|pacote/i })).toHaveCount(0)
  })
})
