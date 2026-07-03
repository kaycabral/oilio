import { expect, test } from '../fixtures'
import { chooseOption, chooseOptionByIndex } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  seedSubscription,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Brief 0019 — decisão 2026-05-22 (issue #960/#963): recepção respeita as
// mesmas regras de plano que o self-book. Bypass histórico (AC-15) foi
// cancelado. Esse spec garante que o /agenda interno bloqueia uma criação
// que viola bookingLimits, em vez de criar silenciosamente + logar bypass.

async function seedScopeFixture(org: SeededOrg): Promise<{ customerName: string }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    unitIds: org.unitIds,
  })
  const customerName = `Plano Limitado ${Date.now()}`
  const customerId = await seedCustomer(org.orgId, {
    name: customerName,
    mobile: uniqueWhatsapp(),
  })
  // Plano com maxPerDay = 1 — qualquer 2ª criação no mesmo dia deve cair.
  await seedSubscription(org.orgId, customerId, { bookingLimits: { maxPerDay: 1 } })
  // Já existe 1 agendamento hoje em 14:00 BR (17:00 UTC).
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
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
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('criar 2º agendamento no mesmo dia para cliente com maxPerDay=1 é bloqueado', async ({
      org,
      authedPage,
    }) => {
      const { customerName } = await seedScopeFixture(org)
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
      await chooseOption(dialog, 'Início', '15:00')

      await dialog.getByRole('button', { name: /^Agendar$/ }).click()

      // Mensagem do enforceSubscriptionScope (rule = maxPerDay).
      await expect(
        dialog.getByText(/limite de \d+ agendamento\(s\) no dia pelo plano/i),
      ).toBeVisible()
    })
  },
)
