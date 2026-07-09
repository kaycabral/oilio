import { expect, test } from '../fixtures'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedSharedSlot(
  org: SeededOrg,
): Promise<{ activeName: string; cancelledName: string }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
  })
  const activeName = 'Ativo Slot'
  const cancelledName = 'Cancelado Slot'
  const activeCustomerId = await seedCustomer(org.orgId, {
    name: activeName,
    mobile: uniqueWhatsapp(),
  })
  const cancelledCustomerId = await seedCustomer(org.orgId, {
    name: cancelledName,
    mobile: uniqueWhatsapp(),
  })
  for (const [customerId, status] of [
    [activeCustomerId, 'scheduled'],
    [cancelledCustomerId, 'cancelled'],
  ] as const) {
    await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: org.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt: '2026-08-12T17:00:00.000Z',
      endAt: '2026-08-12T17:30:00.000Z',
      status,
    })
  }
  return { activeName, cancelledName }
}

test.describe('Agenda — toggle mostrar cancelados + slot dividido', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('ligar o toggle reexibe o cancelado lado a lado com o ativo', async ({
    org,
    authedPage,
  }) => {
    const { activeName, cancelledName } = await seedSharedSlot(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')

    await expect(agenda.appointmentCard(new RegExp(activeName))).toBeVisible()
    await expect(agenda.appointmentCard(new RegExp(cancelledName))).toHaveCount(0)

    await agenda.showCancelledToggle().click()
    await expect(authedPage).toHaveURL(/showCancelled=1/)
    const cancelledCard = agenda.appointmentCard(new RegExp(cancelledName))
    await expect(cancelledCard).toBeVisible()
    await expect(agenda.appointmentCard(new RegExp(activeName))).toBeVisible()

    const activeBox = await agenda.appointmentCard(new RegExp(activeName)).boundingBox()
    const cancelledBox = await cancelledCard.boundingBox()
    expect(activeBox).not.toBeNull()
    expect(cancelledBox).not.toBeNull()
    expect(Math.abs(activeBox!.x - cancelledBox!.x)).toBeGreaterThan(20)
    expect(Math.abs(activeBox!.y - cancelledBox!.y)).toBeLessThan(2)

    await expect(cancelledCard).toHaveClass(/line-through/)
    await expect(agenda.appointmentCard(new RegExp(activeName))).not.toHaveClass(/line-through/)

    await agenda.showCancelledToggle().click()
    await expect(authedPage).not.toHaveURL(/showCancelled=1/)
    await expect(agenda.appointmentCard(new RegExp(cancelledName))).toHaveCount(0)
  })
})
