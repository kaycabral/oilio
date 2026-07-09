import { expect, test } from '../fixtures'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedScheduledAndCancelled(
  org: SeededOrg,
): Promise<{ activeName: string; cancelledName: string }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
  })
  const activeName = 'Ativo Cliente'
  const cancelledName = 'Cancelado Cliente'
  const activeCustomerId = await seedCustomer(org.orgId, {
    name: activeName,
    mobile: uniqueWhatsapp(),
  })
  const cancelledCustomerId = await seedCustomer(org.orgId, {
    name: cancelledName,
    mobile: uniqueWhatsapp(),
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
    customerId: activeCustomerId,
    serviceId,
    startAt: '2026-08-12T17:00:00.000Z',
    endAt: '2026-08-12T17:30:00.000Z',
    status: 'scheduled',
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
    customerId: cancelledCustomerId,
    serviceId,
    startAt: '2026-08-12T18:00:00.000Z',
    endAt: '2026-08-12T18:30:00.000Z',
    status: 'cancelled',
  })
  return { activeName, cancelledName }
}

test.describe('Agenda — cancelados ocultos por default', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('o cancelado não aparece na grade; o agendado segue visível', async ({
    org,
    authedPage,
  }) => {
    const { activeName, cancelledName } = await seedScheduledAndCancelled(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')

    await expect(agenda.appointmentCard(new RegExp(activeName))).toBeVisible()
    await expect(agenda.appointmentCard(new RegExp(cancelledName))).toHaveCount(0)
  })
})
