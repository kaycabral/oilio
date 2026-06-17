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

import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { intStrField, parseJson } from '../helpers/firestore-rest'
import { rowAction } from '../helpers/list'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption } from '../helpers/select'
import {
  readCatalogItem,
  seedAppointment,
  seedCatalogItem,
  seedCategory,
  seedCustomer,
  seedSubscription,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const docUrl = (tenantId: string, path: string) =>
  `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/tenants/${tenantId}/${path}`

function readConsumed(tenantId: string, subId: string): number {
  const out = execFileSync('curl', [
    '-fsS',
    docUrl(tenantId, `subscriptions/${subId}`),
    '-H',
    'Authorization: Bearer owner',
  ])
  const data = parseJson(
    out.toString(),
    Schema.decodeUnknownSync(
      Schema.Struct({
        fields: Schema.optional(
          Schema.Struct({
            currentPeriod: Schema.optional(
              Schema.Struct({
                mapValue: Schema.optional(
                  Schema.Struct({
                    fields: Schema.optional(
                      Schema.Struct({
                        consumed: Schema.optional(
                          Schema.Struct({ integerValue: Schema.optional(Schema.String) }),
                        ),
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  )
  return Number(data.fields?.currentPeriod?.mapValue?.fields?.consumed?.integerValue ?? '0')
}

function readStock(tenantId: string, itemId: string): number {
  return Number(intStrField(readCatalogItem(tenantId, itemId) ?? undefined, 'stock') ?? '0')
}

function countOrderCommissions(tenantId: string, orderId: string): number {
  const out = execFileSync('curl', [
    '-fsS',
    docUrl(tenantId, 'commissions'),
    '-H',
    'Authorization: Bearer owner',
  ])
  const data = parseJson(
    out.toString(),
    Schema.decodeUnknownSync(
      Schema.Struct({
        documents: Schema.optional(
          Schema.Array(
            Schema.Struct({
              fields: Schema.optional(
                Schema.Struct({
                  orderId: Schema.optional(
                    Schema.Struct({ stringValue: Schema.optional(Schema.String) }),
                  ),
                }),
              ),
            }),
          ),
        ),
      }),
    ),
  )
  return (data.documents ?? []).filter((d) => d.fields?.orderId?.stringValue === orderId).length
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
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: plano cobre itens granulares (serviço e produto)', async ({
    tenant,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const serviceName = `Barba ${ts}`
    const productName = `Pomada ${ts}`
    seedCatalogItem(tenant.tenantId, { kind: 'service', name: serviceName })
    seedCatalogItem(tenant.tenantId, { kind: 'product', name: productName })
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

  test('Cenário 2: consumo resolve em granular, por kind', async ({ tenant, authedPage }) => {
    const ts = Date.now().toString()
    const unitId = tenant.unitIds[0]!
    const productCategoryId = seedCategory(tenant.tenantId, { name: `Produtos ${ts}` })
    const serviceId = seedCatalogItem(tenant.tenantId, {
      kind: 'service',
      name: `Barba ${ts}`,
      priceCents: 4000,
      durationMinutes: 30,
      unitIds: [unitId],
      commission: { kind: 'percentage', value: 50 },
    })
    const productId = seedCatalogItem(tenant.tenantId, {
      kind: 'product',
      name: `Pomada ${ts}`,
      priceCents: 1500,
      categoryId: productCategoryId,
      unitIds: [unitId],
      stock: 10,
    })
    const customerId = seedCustomer(tenant.tenantId, {
      name: `Cliente DoD ${ts}`,
      whatsapp: `1199${ts.slice(-7)}`,
    })
    // Snapshot congelado: serviço coberto por item, produto por categoria.
    const subId = seedSubscription(tenant.tenantId, customerId, {
      planName: 'Granular DoD',
      usageLimit: { kind: 'count', quantity: 4 },
      includedItemIds: [serviceId],
      includedCategoryIds: [productCategoryId],
    })
    seedAppointment({
      tenantId: tenant.tenantId,
      unitId,
      professionalId: tenant.professionalIds[0]!,
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

    // Serviço coberto.
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: `Barba ${ts}` }),
      'Cobertura do item',
      'Consumo do plano',
    )
    // Produto coberto (via categoria).
    await addCatalogItemToOrder(authedPage, `Pomada ${ts}`)
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: `Pomada ${ts}` }),
      'Cobertura do item',
      'Consumo do plano',
    )

    await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
    await confirmClose(authedPage)

    // Resolução granular por kind: cota debita 2 (serviço+produto); serviço
    // coberto não gera comissão; produto coberto baixa estoque (10−1).
    expect(readConsumed(tenant.tenantId, subId)).toBe(2)
    expect(countOrderCommissions(tenant.tenantId, orderId)).toBe(0)
    expect(readStock(tenant.tenantId, productId)).toBe(9)
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
