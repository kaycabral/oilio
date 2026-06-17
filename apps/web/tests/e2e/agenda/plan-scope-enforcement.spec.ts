import { expect, test } from '../fixtures'
import { chooseOption, chooseOptionByIndex } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  seedSubscription,
  type SeededTenant,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Brief 0019 — decisão 2026-05-22 (issue #960/#963): recepção respeita as
// mesmas regras de plano que o self-book. Bypass histórico (AC-15) foi
// cancelado. Esse spec garante que o /agenda interno bloqueia uma criação
// que viola bookingLimits, em vez de criar silenciosamente + logar bypass.

function seedScopeFixture(tenant: SeededTenant): { customerName: string } {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    unitIds: tenant.unitIds,
  })
  const customerName = `Plano Limitado ${Date.now()}`
  const customerId = seedCustomer(tenant.tenantId, {
    name: customerName,
    whatsapp: '11955554444',
  })
  // Plano com maxPerDay = 1 — qualquer 2ª criação no mesmo dia deve cair.
  seedSubscription(tenant.tenantId, customerId, { bookingLimits: { maxPerDay: 1 } })
  // Já existe 1 agendamento hoje em 14:00 BR (17:00 UTC).
  seedAppointment({
    tenantId: tenant.tenantId,
    unitId: tenant.unitIds[0]!,
    professionalId: tenant.professionalIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-08-12T17:00:00.000Z',
    endAt: '2026-08-12T17:30:00.000Z',
    status: 'scheduled',
  })
  return { customerName }
}

test.describe(
  'Agenda — recepção respeita regras de plano (sem bypass)',
  { tag: '@critical' },
  () => {
    test.use({
      tenantInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('criar 2º agendamento no mesmo dia para cliente com maxPerDay=1 é bloqueado', async ({
      tenant,
      authedPage,
    }) => {
      const { customerName } = seedScopeFixture(tenant)
      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-08-12')

      const dialog = await agenda.openNewAppointmentDialog()
      await expect(dialog).toBeVisible()

      // Comboboxes (Radix Select) — escolhe pela visible text de cada option.
      await chooseOption(dialog, 'Serviço', /Corte/)
      await chooseOptionByIndex(dialog, 'Profissional', 0)
      await chooseOption(dialog, 'Cliente', new RegExp(customerName))

      // Outro horário do mesmo dia (15:00 BR = 18:00 UTC), ainda livre.
      await dialog.locator('input[name="date"]').fill('2026-08-12')
      await dialog.locator('input[name="startTime"]').fill('15:00')

      await dialog.getByRole('button', { name: /^Agendar$/ }).click()

      // Mensagem do enforceSubscriptionScope (rule = maxPerDay).
      await expect(
        dialog.getByText(/limite de \d+ agendamento\(s\) no dia pelo plano/i),
      ).toBeVisible()
    })
  },
)
