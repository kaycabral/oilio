import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
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

const TrackingSchema = Schema.Struct({
  cancelledBy: Schema.optional(Schema.String),
})
const decodeTracking = Schema.decodeUnknownSync(TrackingSchema)

test.describe('Me — auto-cancelamento de cliente', { tag: '@critical' }, () => {
  test('cliente cancela seu agendamento dentro da janela', async ({ context, page, baseURL }) => {
    const seed = await seedOrg({
      unitCount: 1,
      memberOperationCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 60 },
    })
    const serviceId = await seedService(seed.orgId, {
      name: 'Corte',
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
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 60 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    page.on('dialog', (d) => d.accept())

    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(page.getByRole('heading', { name: /meus agendamentos/i })).toBeVisible()
    await expect(me.appointmentByService('Corte')).toBeVisible()

    await me.cancelButton().click()
    await expect(page.getByText(/cancelado/i).first()).toBeVisible()

    const apptRow = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, seed.orgId, apptId),
    )
    expect(apptRow).not.toBeNull()
    expect(apptRow?.status).toBe('cancelled')
    expect(decodeTracking(apptRow?.tracking).cancelledBy).toBe('customer')
  })

  test('cliente não cancela dentro da janela — botão desabilitado com tooltip', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({
      unitCount: 1,
      memberOperationCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
    })
    const serviceId = await seedService(seed.orgId, {
      name: 'Corte Tight',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await seedAuthUser()
    const customerId = await seedCustomerShadowForUser(seed.orgId, customer.uid)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    await seedAppointment({
      orgId: seed.orgId,
      unitId: seed.unitIds[0]!,
      memberOperationId: seed.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })

  test('elegibilidade usa o snapshot da policy, não a policy viva do org (#1038)', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({
      unitCount: 1,
      memberOperationCount: 1,
      cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
    })
    const serviceId = await seedService(seed.orgId, {
      name: 'Corte Snapshot',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await seedAuthUser()
    const customerId = await seedCustomerShadowForUser(seed.orgId, customer.uid)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    await seedAppointment({
      orgId: seed.orgId,
      unitId: seed.unitIds[0]!,
      memberOperationId: seed.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })
})
