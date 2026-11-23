import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Schema } from 'effect'
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

const CurrentPeriodSchema = Schema.Struct({
  consumed: Schema.optional(Schema.Number),
})
const decodeCurrentPeriod = Schema.decodeUnknownSync(CurrentPeriodSchema)

async function readConsumed(orgId: string, subId: string): Promise<number> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  if (!row) throw new Error(`readConsumed: subscription ${subId} not found`)
  return decodeCurrentPeriod(row.current_period).consumed ?? 0
}

async function seedServiceFor(
  org: SeededOrg,
  customerName: string,
  mobile: string,
  withSubscription: boolean,
): Promise<{ customerId: string; subId: string | null }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, { name: customerName, mobile })
  const subId = withSubscription
    ? await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        includedItemIds: [serviceId],
      })
    : null
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

async function startOrderFor(authedPage: Page, customerName: string): Promise<void> {
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await agenda.startAttendance(new RegExp(customerName))
}

async function confirmClose(authedPage: Page): Promise<void> {
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe(
  'Feature 0021 — Definition of Done (fechamento fiscal-ready)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('Cenário 1: venda real fecha com forma de pagamento real', async ({ org, authedPage }) => {
      await seedServiceFor(org, 'Cliente Venda', uniqueWhatsapp(), false)
      await startOrderFor(authedPage, 'Cliente Venda')

      await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

      await choosePaymentMethod(authedPage, 'cash')
      await confirmClose(authedPage)

      await expect(authedPage.getByText(/Dinheiro/).first()).toBeVisible()
    })

    test('Cenário 2: comanda 100% coberta fecha como consumo (sem tender, sem NF)', async ({
      org,
      authedPage,
    }) => {
      const { subId } = await seedServiceFor(org, 'Cliente Plano', uniqueWhatsapp(), true)
      await startOrderFor(authedPage, 'Cliente Plano')

      await expect(
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Corte' })
          .getByRole('combobox', { name: 'Cobertura do item' }),
      ).toHaveText('Consumo do plano')

      await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
      await confirmClose(authedPage)

      expect(await readConsumed(org.orgId, subId!)).toBe(1)
    })

    test('Cenário 3: comanda mista (coberto + vendido) → paga só o produto', async ({
      org,
      authedPage,
    }) => {
      const { subId } = await seedServiceFor(org, 'Cliente Misto', uniqueWhatsapp(), true)
      await seedProduct(org.orgId, { name: 'Pomada', priceCents: 3000 })
      await startOrderFor(authedPage, 'Cliente Misto')

      await expect(
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Corte' })
          .getByRole('combobox', { name: 'Cobertura do item' }),
      ).toHaveText('Consumo do plano')

      await addCatalogItemToOrder(authedPage, 'Pomada')

      await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()

      await choosePaymentMethod(authedPage, 'pix')
      await confirmClose(authedPage)

      await expect(authedPage.getByText(/PIX/).first()).toBeVisible()
      expect(await readConsumed(org.orgId, subId!)).toBe(1)
    })
  },
)
