import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { aggregateRef } from '@/domain/effect'
import { expect, test } from './fixtures'
import {
  pgReadProjection,
  seedAppointment,
  seedAuthUser,
  seedCustomerShadowForUser,
  seedOrg,
  seedService,
  signInAndAttachSession,
} from './helpers/session'
import { MeAppointmentsPage } from './pages'

// Brief 0080, Grupo C (#1310) — customer self-service reschedule from
// /me/appointments. The seeded unit is appointment-mode (Mon–Fri 09:00–18:00,
// 15-min grid by seedOrg default), so the picker offers grid times and the
// backend reapplies the full validation layer on the move.
//
// Picks the next weekday (the unit is closed on weekends) so a grid slot exists,
// and a mid-morning grid-aligned time well within business hours.
function nextWeekday(): { date: string; time: string } {
  const d = new Date(Date.now() + 24 * 60 * 60_000)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1)
  }
  // UTC date — the unit tz (America/Sao_Paulo) is behind UTC, so a UTC weekday
  // mid-morning maps to the same weekday locally; 10:00 is safely inside hours.
  const date = d.toISOString().slice(0, 10)
  return { date, time: '10:00' }
}

test.describe('Me — reagendamento self-service do cliente', { tag: '@critical' }, () => {
  test('cliente reagenda seu agendamento para um slot válido da grade', async ({
    context,
    page,
    baseURL,
  }) => {
    // Policy disabled → no notice window, so the appointment (3h ahead) is
    // always reschedule-eligible. The reschedule moves it to a new grid slot.
    const seed = await seedOrg({
      unitCount: 1,
      memberOperationCount: 1,
      slotMinutes: 15,
      cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
    })
    const serviceId = await seedService(seed.orgId, {
      name: 'Corte Reagendável',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await seedAuthUser()
    const customerId = await seedCustomerShadowForUser(seed.orgId, customer.uid)
    const startAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 3.5 * 60 * 60_000).toISOString()
    const apptId = await seedAppointment({
      orgId: seed.orgId,
      unitId: seed.unitIds[0]!,
      memberOperationId: seed.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      cancellationPolicySnapshot: { enabled: false, minNoticeMinutes: 0 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(page.getByRole('heading', { name: /meus agendamentos/i })).toBeVisible()
    await expect(me.appointmentByService('Corte Reagendável')).toBeVisible()

    // Open the inline reschedule panel, pick a new grid slot, confirm.
    await me.rescheduleButton().click()
    const { date, time } = nextWeekday()
    await me.dateInput().fill(date)
    await me.pickTime(time)
    await me.confirmRescheduleButton().click()

    // On success the panel closes and the Server Component re-renders with the
    // new (server-projected) time via `router.refresh()` — there is no longer a
    // stale "atualize a página" banner showing the OLD time (#B9). Assert the
    // reschedule panel is gone and the appointment still shows, scheduled.
    await expect(me.confirmRescheduleButton()).toBeHidden()
    await expect(me.appointmentByService('Corte Reagendável')).toBeVisible()
    await expect(page.getByText(/atualize a página/i)).toHaveCount(0)

    // Projection moved: the appointment's start_at is now the chosen slot, and a
    // `appointment.rescheduled` event was emitted by the customer.
    const apptRow = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, seed.orgId, apptId),
    )
    expect(apptRow).not.toBeNull()
    expect(apptRow?.status).toBe('scheduled')
    // The new start instant differs from the original 3h-ahead seed.
    expect(new Date(String(apptRow?.start_at)).toISOString()).not.toBe(startAt)
  })
})
