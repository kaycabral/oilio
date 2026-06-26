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

// Issue #845 — Cliente self-cancel a partir de /me/appointments.
//
// Cobre o golden path (cancel dentro da janela) + gate de policy (botão
// disabled quando a antecedência mínima já foi violada).

// Lenient decoder for the `tracking` JSONB blob on the appointments projection.
// `cancelledBy` lives inside this blob (not a top-level column), so the read-back
// pulls it out after the customer self-cancels.
const TrackingSchema = Schema.Struct({
  cancelledBy: Schema.optional(Schema.String),
})
const decodeTracking = Schema.decodeUnknownSync(TrackingSchema)

test.describe('Me — auto-cancelamento de cliente', { tag: '@critical' }, () => {
  test('cliente cancela seu agendamento dentro da janela', async ({ context, page, baseURL }) => {
    // Org with policy enabled @ 60 min notice. The appointment is 3h
    // ahead → safely within the window. Customer signs in as a separate
    // identity (not the org owner), so we bypass `authedPage` and use
    // the imperative `signInAndAttachSession` with the customer creds.
    const seed = await seedOrg({
      unitCount: 1,
      professionalCount: 1,
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
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      // Snapshot mirrors the org policy at commit time (#1038).
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 60 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    page.on('dialog', (d) => d.accept())

    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(page.getByRole('heading', { name: /meus agendamentos/i })).toBeVisible()
    await expect(me.appointmentByService('Corte')).toBeVisible()

    await me.cancelButton().click()
    // After the action, the row swaps to the "Cancelado" badge.
    await expect(page.getByText(/cancelado/i).first()).toBeVisible()

    // Confirm the Postgres projection reflects the cancel + audit landed. The
    // appointment `status` is a top-level column; `cancelledBy` lives in the
    // `tracking` JSONB blob (decoded leniently).
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
    // 2h policy; appointment 30 min ahead → outside the window.
    const seed = await seedOrg({
      unitCount: 1,
      professionalCount: 1,
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
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      // Snapshot mirrors the org policy at commit time (#1038).
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
    // Booking committed under a strict policy (snapshot enabled @ 120 min). The
    // appointment is 30 min ahead → inside the window → blocked by the snapshot.
    // The LIVE unit policy is seeded RELAXED (disabled), so if the read-site
    // wrongly used the live policy the button would become enabled. Post-cutover
    // the cancellation policy is the unit's (PRD Identidade v2 — moved Org→Unit);
    // the read fallback in `load-me` reads `unit.agenda.cancellationPolicy`, so
    // seeding the org's policy disabled IS the relaxed live policy. Snapshot-on-
    // use means the customer's right to cancel is still evaluated against the
    // frozen snapshot (120 min), so the button stays disabled.
    const seed = await seedOrg({
      unitCount: 1,
      professionalCount: 1,
      // Relaxed LIVE policy — disabled. Was previously asserted via a stale org
      // PATCH that the read path never consulted (it reads the unit's agenda).
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
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      // Frozen at commit: strict 120-min policy.
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    // Snapshot (120 min) still governs → cancel stays blocked.
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })
})
