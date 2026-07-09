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

function nextWeekday(): { date: string; time: string } {
  const d = new Date(Date.now() + 24 * 60 * 60_000)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1)
  }
  const date = d.toISOString().slice(0, 10)
  return { date, time: '10:00' }
}

test.describe('Me — reagendamento self-service do cliente', { tag: '@critical' }, () => {
  test('cliente reagenda seu agendamento para um slot válido da grade', async ({
    context,
    page,
    baseURL,
  }) => {
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

    await me.rescheduleButton().click()
    const { date, time } = nextWeekday()
    await me.dateInput().fill(date)
    await me.pickTime(time)
    await me.confirmRescheduleButton().click()

    await expect(me.confirmRescheduleButton()).toBeHidden()
    await expect(me.appointmentByService('Corte Reagendável')).toBeVisible()
    await expect(page.getByText(/atualize a página/i)).toHaveCount(0)

    const apptRow = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, seed.orgId, apptId),
    )
    expect(apptRow).not.toBeNull()
    expect(apptRow?.status).toBe('scheduled')
    expect(new Date(String(apptRow?.start_at)).toISOString()).not.toBe(startAt)
  })
})
