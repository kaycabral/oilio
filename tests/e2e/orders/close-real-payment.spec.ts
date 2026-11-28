import { SubscriptionConfig } from '@/domain/aggregates/subscription/config'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Effect, Schema } from 'effect'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  pgReadProjection,
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  seedSubscription,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const SubscriptionRowSchema = Schema.Struct({
  current_period: Schema.Struct({
    consumed: Schema.Number.pipe(Schema.withDecodingDefaultType(Effect.succeed(0))),
  }),
})
const decodeSubscriptionRow = Schema.decodeUnknownSync(SubscriptionRowSchema)

async function readConsumed(orgId: string, subId: string): Promise<number> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  expect(row).not.toBeNull()
  return decodeSubscriptionRow(row).current_period.consumed
}

async function seedFixture(
  org: SeededOrg,
  subOpts: Parameters<typeof seedSubscription>[2] = {},
): Promise<{ customerId: string; subId: string }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  await seedProduct(org.orgId, { name: 'Pomada', priceCents: 3000 })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Plano',
    mobile: uniqueWhatsapp(),
  })
  const subId = await seedSubscription(org.orgId, customerId, {
    planName: 'Mensal Corte',
    usageLimit: { kind: 'count', quantity: 4 },
    includedItemIds: [serviceId],
    ...subOpts,
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-09-08T17:00:00.000Z',
    endAt: '2026-09-08T17:30:00.000Z',
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: { kind: 'percentage', value: 50 },
  })
  return { customerId, subId }
}

test.describe('Order — fechamento fiscal-ready (#990/#991/#992)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  async function startOrder(authedPage: Page) {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await agenda.startAttendance(/Cliente Plano/)
  }

  test('comanda mista: serviço coberto + produto vendido → paga só o produto, consome 1', async ({
    org,
    authedPage,
  }) => {
    const { subId } = await seedFixture(org)
    await startOrder(authedPage)

    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Corte' })
        .getByRole('combobox', { name: 'Cobertura do item' }),
    ).toHaveText('Consumo do plano')

    await addCatalogItemToOrder(authedPage, 'Pomada')

    await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(authedPage.getByText(/Fechada em/)).toBeVisible()
    await expect(authedPage.getByText(/PIX/).first()).toBeVisible()
    expect(await readConsumed(org.orgId, subId)).toBe(1)
  })

  test('comanda 100% coberta fecha sem forma de pagamento (AC-06)', async ({ org, authedPage }) => {
    const { subId } = await seedFixture(org)
    await startOrder(authedPage)

    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Corte' })
        .getByRole('combobox', { name: 'Cobertura do item' }),
    ).toHaveText('Consumo do plano')

    await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog.getByText('Consumo do plano', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(authedPage.getByText(/Fechada em/)).toBeVisible()
    expect(await readConsumed(org.orgId, subId)).toBe(1)
  })

  test('assinatura sem saldo: opção de consumo fica desabilitada (degenerado)', async ({
    org,
    authedPage,
  }) => {
    await seedFixture(org, { usageLimit: { kind: 'count', quantity: 1 }, consumed: 1 })
    await startOrder(authedPage)

    const coverage = authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Corte' })
      .getByRole('combobox', { name: 'Cobertura do item' })
    await expect(coverage).toBeVisible()
    await coverage.click()
    await expect(authedPage.getByRole('option', { name: 'Consumo do plano' })).toBeDisabled()
  })
})
