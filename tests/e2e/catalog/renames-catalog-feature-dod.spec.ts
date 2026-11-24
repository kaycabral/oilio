import { execFileSync } from 'node:child_process'

import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { choosePaymentMethod } from '../helpers/select'
import {
  linkMemberOperationToServices,
  seedAppointment,
  seedCustomer,
  seedService,
  skipOnPostgres,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

test.describe('Feature 0052 — Definition of Done (renames de catálogo, B2)', () => {
  test.describe('Cenário 1 — booking por profissional usa catalogServiceIds', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('availability lista/aloca o pro vinculado via catalogServiceIds e dropa slot tomado', async ({
      org,
      page,
    }) => {
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte B2',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

      const targetDate = nextWeekday('Wed')
      const cust = await seedCustomer(org.orgId, { name: 'Tomado', mobile: uniqueWhatsapp() })
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        memberOperationId: org.memberOperationIds[0]!,
        customerId: cust,
        serviceId,
        startAt: `${targetDate}T12:00:00.000Z`,
        endAt: `${targetDate}T12:30:00.000Z`,
        status: 'scheduled',
      })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(page.getByRole('heading', { name: /escolha data e horário/i })).toBeVisible()

      await expect(page.getByText('09:30').first()).toBeVisible()
      await expect(page.getByText('10:00').first()).toBeVisible()
      await expect(page.getByText('09:00').first()).toHaveCount(0)
    })

    test('pro sem o serviço em catalogServiceIds é filtrado da disponibilidade', async ({
      org,
      page,
    }) => {
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Barba B2',
        durationMinutes: 30,
        priceCents: 4000,
        publicVisible: true,
        unitIds: [unitId],
      })
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(page.getByText(/sem horários disponíveis nesta data/i)).toBeVisible()
    })
  })

  test.describe('Cenário 3 — comissão por serviço calcula idêntico pós-rename', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    if (!skipOnPostgres())
      test('fechar comanda com serviço comissionável gera comissão pendente', async ({
        org,
        authedPage,
      }) => {
        const serviceId = await seedService(org.orgId, {
          name: 'Corte Comissão B2',
          durationMinutes: 30,
          priceCents: 6000,
          publicVisible: true,
          commission: { kind: 'percentage', value: 50 },
          unitIds: org.unitIds,
        })
        const customerName = `Cliente Com ${Date.now()}`
        const customerId = await seedCustomer(org.orgId, {
          name: customerName,
          mobile: uniqueWhatsapp(),
        })
        await seedAppointment({
          orgId: org.orgId,
          unitId: org.unitIds[0]!,
          memberOperationId: org.memberOperationIds[0]!,
          customerId,
          serviceId,
          startAt: '2026-09-09T17:00:00.000Z',
          endAt: '2026-09-09T17:30:00.000Z',
          status: 'scheduled',
          servicePriceCentsSnapshot: 6000,
          serviceDurationMinutesSnapshot: 30,
          commissionSnapshot: { kind: 'percentage', value: 50 },
        })

        const agenda = new AgendaPage(authedPage)
        await agenda.goto('2026-09-09')
        await authedPage.getByRole('button', { name: new RegExp(customerName) }).click()
        await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
        await expect(authedPage).toHaveURL(/\/orders\/.+/)

        await expect(authedPage.getByText('R$ 60,00').first()).toBeVisible()
        await choosePaymentMethod(authedPage, 'pix')
        await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
        const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
        await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
        await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

        await authedPage.goto('/reports/commissions')
        await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible({ timeout: 5000 })
      })
  })

  test('Cenário 4 — nenhum símbolo legado restante (guard de lint)', () => {
    const out = execFileSync('node', ['scripts/no-legacy-catalog-symbols.mjs'], {
      encoding: 'utf8',
    })
    expect(out).toBe('')
  })
})
