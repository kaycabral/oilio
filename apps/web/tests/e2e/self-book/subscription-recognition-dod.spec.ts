import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import {
  pgReadProjection,
  seedAppointment,
  seedCatalogItem,
  seedCustomer,
  seedSubscription,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

const CurrentPeriodConsumed = Schema.decodeUnknownSync(Schema.Struct({ consumed: Schema.Number }))

async function readConsumed(orgId: string, subId: string): Promise<number> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  if (!row) throw new Error(`readConsumed: subscription ${subId} not found`)
  return CurrentPeriodConsumed(row.current_period).consumed
}

async function confirmClose(authedPage: Page): Promise<void> {
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe(
  'brief 0079 — Feature-level DoD (reconhecimento de assinatura)',
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

    test('Cenário 1: assinante agenda serviço coberto e vê o selo "no seu plano"', async ({
      org,
      authedPage,
    }) => {
      const ts = Date.now().toString()
      const unitId = org.unitIds[0]!
      const coveredId = await seedCatalogItem(org.orgId, {
        kind: 'service',
        name: `Corte ${ts}`,
        priceCents: 4500,
        durationMinutes: 30,
        unitIds: [unitId],
        publicVisible: true,
      })
      await seedCatalogItem(org.orgId, {
        kind: 'service',
        name: `Sobrancelha ${ts}`,
        priceCents: 2000,
        durationMinutes: 15,
        unitIds: [unitId],
        publicVisible: true,
      })

      const customerId = await seedCustomer(org.orgId, { name: `Assinante ${ts}`, userId: org.uid })
      await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        includedItemIds: [coveredId],
      })

      const booking = new PublicBookingPage(authedPage, orgSlug(org.orgId))
      await booking.gotoCatalog()

      const coveredRow = authedPage.getByRole('listitem').filter({ hasText: `Corte ${ts}` })
      await expect(coveredRow.getByText('no seu plano')).toBeVisible()
      const uncoveredRow = authedPage.getByRole('listitem').filter({ hasText: `Sobrancelha ${ts}` })
      await expect(uncoveredRow.getByText('no seu plano')).toHaveCount(0)
      await expect(authedPage.getByText(/R\$\s*45,00/)).toBeVisible()
      await expect(authedPage.getByText(/saldo|restante|\b\d+\/\d+\b/i)).toHaveCount(0)
    })

    test('Cenário 2: operador fecha comanda de item coberto sem flip manual (cota 0→1)', async ({
      org,
      authedPage,
    }) => {
      const ts = Date.now().toString()
      const unitId = org.unitIds[0]!
      const serviceId = await seedCatalogItem(org.orgId, {
        kind: 'service',
        name: `Corte ${ts}`,
        priceCents: 4500,
        durationMinutes: 30,
        unitIds: [unitId],
      })
      const customerId = await seedCustomer(org.orgId, { name: `Cliente ${ts}` })
      const subId = await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        consumed: 0,
        includedItemIds: [serviceId],
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
        servicePriceCentsSnapshot: 4500,
        serviceDurationMinutesSnapshot: 30,
        commissionSnapshot: null,
      })

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: new RegExp(`Cliente ${ts}`) }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)

      await expect(
        authedPage
          .getByRole('listitem')
          .filter({ hasText: `Corte ${ts}` })
          .getByRole('combobox', { name: 'Cobertura do item' }),
      ).toHaveText('Consumo do plano')
      await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
      await confirmClose(authedPage)

      expect(await readConsumed(org.orgId, subId)).toBe(1)
    })

    test('Cenário 3: cota esgotada → serviço vira avulso no wizard (sem selo, preço cheio)', async ({
      org,
      authedPage,
    }) => {
      const ts = Date.now().toString()
      const unitId = org.unitIds[0]!
      const serviceId = await seedCatalogItem(org.orgId, {
        kind: 'service',
        name: `Corte ${ts}`,
        priceCents: 4500,
        durationMinutes: 30,
        unitIds: [unitId],
        publicVisible: true,
      })
      const customerId = await seedCustomer(org.orgId, { name: `Assinante ${ts}`, userId: org.uid })
      await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        consumed: 4,
        includedItemIds: [serviceId],
      })

      const booking = new PublicBookingPage(authedPage, orgSlug(org.orgId))
      await booking.gotoCatalog()

      await expect(authedPage.getByText(`Corte ${ts}`)).toBeVisible()
      await expect(authedPage.getByText('no seu plano')).toHaveCount(0)
      await expect(authedPage.getByText(/R\$\s*45,00/)).toBeVisible()
      await expect(authedPage.getByText(/esgotad/i)).toHaveCount(0)
    })
  },
)
