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
  await seedSubscription(org.orgId, customerId, { bookingLimits: { maxPerDay: 1 } })
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

      await chooseOption(dialog, 'Serviço', /Corte/)
      await chooseOptionByIndex(dialog, 'Profissional', 0)
      await chooseOption(dialog, 'Cliente', new RegExp(customerName))

      await dialog.locator('input[name="date"]').fill('2026-08-12')
      await chooseOption(dialog, 'Início', '15:00')

      await dialog.getByRole('button', { name: /^Agendar$/ }).click()

      await expect(
        dialog.getByText(/limite de \d+ agendamento\(s\) no dia pelo plano/i),
      ).toBeVisible()
    })
  },
)
