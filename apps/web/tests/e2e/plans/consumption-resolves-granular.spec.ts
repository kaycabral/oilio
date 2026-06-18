// E2E — brief 0024 § DoD Cenário 2 / Grupo B (AC-04/05, #1009).
//
// A customer holds a subscription whose FROZEN snapshot covers {a service (via
// `includedItemIds`) + a product (via `includedCategoryIds` convenience)}.
// Closing a comanda that consumes both must:
//  - resolve each covered line against the snapshot → both stay `coverage:subscription`
//  - debit the plan quota by the covered item count (service + product)
//  - generate NO commission for the covered service (brief 0021 AC-09 / 0022 AC-07)
//  - decrement the covered product's stock (AC-05)
//  - respect the plan limit ([[0019]]) — a line outside the snapshot is rejected
//
// Drives the REAL order UI; asserts via Firestore reads + UI.

import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { intStrField, parseJson } from '../helpers/firestore-rest'
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

const docUrl = (orgId: string, path: string) =>
  `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgs/${orgId}/${path}`

function readConsumed(orgId: string, subId: string): number {
  const out = execFileSync('curl', [
    '-fsS',
    docUrl(orgId, `subscriptions/${subId}`),
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

function readStock(orgId: string, itemId: string): number {
  const fields = readCatalogItem(orgId, itemId)
  return Number(intStrField(fields ?? undefined, 'stock') ?? '0')
}

function countCommissions(orgId: string, orderId: string): number {
  const out = execFileSync('curl', [
    '-fsS',
    docUrl(orgId, 'commissions'),
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

test.describe('Plans — consumption resolves granular by kind (#1009)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
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

    // Catalog: a covered service (by item id) + a product in a covered category.
    const productCategoryId = seedCategory(org.orgId, { name: `Produtos ${ts}` })
    const serviceId = seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Barba ${ts}`,
      priceCents: 4000,
      durationMinutes: 30,
      unitIds: [unitId],
      // Commission would be generated if this were a SALE — proves the covered
      // line produces none.
      commission: { kind: 'percentage', value: 50 },
    })
    const productId = seedCatalogItem(org.orgId, {
      kind: 'product',
      name: `Pomada ${ts}`,
      priceCents: 1500,
      categoryId: productCategoryId,
      unitIds: [unitId],
      stock: 10,
    })

    const customerId = seedCustomer(org.orgId, {
      name: `Cliente Granular ${ts}`,
      whatsapp: `1199${ts.slice(-7)}`,
    })
    // Frozen snapshot: service covered by item id, product covered by category.
    const subId = seedSubscription(org.orgId, customerId, {
      planName: 'Granular',
      usageLimit: { kind: 'count', quantity: 4 },
      includedItemIds: [serviceId],
      includedCategoryIds: [productCategoryId],
    })

    // Appointment for the covered service → start the comanda from the agenda.
    seedAppointment({
      orgId: org.orgId,
      unitId,
      professionalId: org.professionalIds[0]!,
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

    // Mark the service as plan consumption.
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: `Barba ${ts}` }),
      'Cobertura do item',
      'Consumo do plano',
    )
    await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()

    // Add the product, then mark IT as plan consumption too (covered by category).
    await addCatalogItemToOrder(authedPage, `Pomada ${ts}`)
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: `Pomada ${ts}` }),
      'Cobertura do item',
      'Consumo do plano',
    )

    // 100% covered → closes with no payment method.
    await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
    await confirmClose(authedPage)

    // Quota debited by covered item count: 1 service + 1 product = 2.
    expect(readConsumed(org.orgId, subId)).toBe(2)
    // Covered service → NO commission generated.
    expect(countCommissions(org.orgId, orderId)).toBe(0)
    // Covered product → stock decremented (10 − 1).
    expect(readStock(org.orgId, productId)).toBe(9)
  })

  test('limit respected: closing beyond plan quota is rejected', async ({ org, authedPage }) => {
    const ts = Date.now().toString()
    const unitId = org.unitIds[0]!
    const serviceId = seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Corte ${ts}`,
      priceCents: 5000,
      durationMinutes: 30,
      unitIds: [unitId],
    })
    const customerId = seedCustomer(org.orgId, {
      name: `Cliente Limite ${ts}`,
      whatsapp: `1198${ts.slice(-7)}`,
    })
    // Plan quota 1, already fully consumed → no balance left this cycle.
    const subId = seedSubscription(org.orgId, customerId, {
      planName: 'Limite',
      usageLimit: { kind: 'count', quantity: 1 },
      consumed: 1,
      includedItemIds: [serviceId],
    })

    seedAppointment({
      orgId: org.orgId,
      unitId,
      professionalId: org.professionalIds[0]!,
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

    // The coverage option is disabled (no balance), so the line stays a SALE —
    // the plan limit is enforced at the UI gate. Consumed stays at 1.
    // Open the (Radix) coverage combobox; options render in a portal at the
    // document root, so query the disabled option from the page.
    await authedPage
      .getByRole('listitem')
      .filter({ hasText: `Corte ${ts}` })
      .getByRole('combobox', { name: 'Cobertura do item' })
      .click()
    await expect(authedPage.getByRole('option', { name: 'Consumo do plano' })).toBeDisabled()
    expect(readConsumed(org.orgId, subId)).toBe(1)
  })
})
