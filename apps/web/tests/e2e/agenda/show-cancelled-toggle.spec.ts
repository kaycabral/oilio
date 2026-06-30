import { expect, test } from '../fixtures'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Brief 0081 (#1312) Cenário 2 [edge]: the "Mostrar cancelados" toggle (off by
// default) re-surfaces cancelled appointments. When a cancelled appointment
// shares a slot with an active one, the two render side by side (horizontal
// split) — the cancelled card visible-but-marked, never covering the active.

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
    whatsapp: uniqueWhatsapp(),
  })
  const cancelledCustomerId = await seedCustomer(org.orgId, {
    name: cancelledName,
    whatsapp: uniqueWhatsapp(),
  })
  // SAME slot: 14:00–14:30 BR == 17:00–17:30 UTC on 2026-08-12. The cancelled
  // one freed it (so booking the active one is legal); the grid must show both
  // side by side when the toggle is on.
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

    // Default: active visible, cancelled hidden.
    await expect(agenda.appointmentCard(new RegExp(activeName))).toBeVisible()
    await expect(agenda.appointmentCard(new RegExp(cancelledName))).toHaveCount(0)

    // Turn the toggle on → URL carries the param and the cancelled card appears.
    await agenda.showCancelledToggle().click()
    await expect(authedPage).toHaveURL(/showCancelled=1/)
    const cancelledCard = agenda.appointmentCard(new RegExp(cancelledName))
    await expect(cancelledCard).toBeVisible()
    await expect(agenda.appointmentCard(new RegExp(activeName))).toBeVisible()

    // Side by side: both cards share the slot at half width, not stacked. The
    // split uses a `calc(... %)` width; a lone/full card never does.
    const activeBox = await agenda.appointmentCard(new RegExp(activeName)).boundingBox()
    const cancelledBox = await cancelledCard.boundingBox()
    expect(activeBox).not.toBeNull()
    expect(cancelledBox).not.toBeNull()
    // Horizontally offset (different left x), vertically aligned (same slot).
    expect(Math.abs(activeBox!.x - cancelledBox!.x)).toBeGreaterThan(20)
    expect(Math.abs(activeBox!.y - cancelledBox!.y)).toBeLessThan(2)

    // The cancelled card carries its struck marking; the active one does not.
    await expect(cancelledCard).toHaveClass(/line-through/)
    await expect(agenda.appointmentCard(new RegExp(activeName))).not.toHaveClass(/line-through/)

    // Turning it off again drops the param and hides the cancelled card.
    await agenda.showCancelledToggle().click()
    await expect(authedPage).not.toHaveURL(/showCancelled=1/)
    await expect(agenda.appointmentCard(new RegExp(cancelledName))).toHaveCount(0)
  })
})
