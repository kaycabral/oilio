import { CatalogItemConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import {
  pgQueryProjection,
  pgReadProjection,
  seedAppointment,
  seedCatalogItem,
  seedCategory,
  seedCustomer,
  seedSubscription,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const CurrentPeriodConsumed = Schema.decodeUnknownSync(Schema.Struct({ consumed: Schema.Number }))

async function readConsumed(orgId: string, subId: string): Promise<number> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  if (!row) throw new Error(`readConsumed: subscription ${subId} not found`)
  return CurrentPeriodConsumed(row.current_period).consumed
}

async function readStock(orgId: string, itemId: string): Promise<number> {
  const row = await pgReadProjection(
    'catalog_items',
    aggregateRef(CatalogItemConfig, orgId, itemId),
  )
  if (!row) throw new Error(`readStock: catalog item ${itemId} not found`)
  return Number(row.stock ?? 0)
}

async function countCommissions(orgId: string, orderId: string): Promise<number> {
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

test.describe('Plans — consumption resolves granular by kind (#1009)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('covered service (item) + covered product (category) → granular lines, no commission, stock decrements', async ({
    org,
    authedPage,
  }) => {
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
      name: `Cliente Granular ${ts}`,
      mobile: uniqueWhatsapp(),
    })
    const subId = await seedSubscription(org.orgId, customerId, {
      planName: 'Granular',
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
    await authedPage.getByRole('button', { name: new RegExp(`Cliente Granular ${ts}`) }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    const orderId = authedPage.url().split('/orders/')[1]!.split(/[?#]/)[0]!

    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: `Barba ${ts}` })
        .getByRole('combobox', { name: 'Cobertura do item' }),
    ).toHaveText('Consumo do plano')

    await addCatalogItemToOrder(authedPage, `Pomada ${ts}`)
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: `Pomada ${ts}` })
        .getByRole('combobox', { name: 'Cobertura do item' }),
    ).toHaveText('Consumo do plano')

    await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
    await confirmClose(authedPage)

    expect(await readConsumed(org.orgId, subId)).toBe(2)
    expect(await countCommissions(org.orgId, orderId)).toBe(0)
    expect(await readStock(org.orgId, productId)).toBe(9)
  })

  test('limit respected: closing beyond plan quota is rejected', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const unitId = org.unitIds[0]!
    const serviceId = await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Corte ${ts}`,
      priceCents: 5000,
      durationMinutes: 30,
      unitIds: [unitId],
    })
    const customerId = await seedCustomer(org.orgId, {
      name: `Cliente Limite ${ts}`,
      mobile: uniqueWhatsapp(),
    })
    const subId = await seedSubscription(org.orgId, customerId, {
      planName: 'Limite',
      usageLimit: { kind: 'count', quantity: 1 },
      consumed: 1,
      includedItemIds: [serviceId],
    })

    await seedAppointment({
      orgId: org.orgId,
      unitId,
      memberOperationId: org.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt: '2026-09-08T18:00:00.000Z',
      endAt: '2026-09-08T18:30:00.000Z',
      status: 'scheduled',
      servicePriceCentsSnapshot: 5000,
      serviceDurationMinutesSnapshot: 30,
      commissionSnapshot: null,
    })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: new RegExp(`Cliente Limite ${ts}`) }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await authedPage
      .getByRole('listitem')
      .filter({ hasText: `Corte ${ts}` })
      .getByRole('combobox', { name: 'Cobertura do item' })
      .click()
    await expect(authedPage.getByRole('option', { name: 'Consumo do plano' })).toBeDisabled()
    expect(await readConsumed(org.orgId, subId)).toBe(1)
  })
})
