import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedAppointment,
  seedCustomerShadowForUser,
  seedService,
  seedSubscription,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe(
  'brief 0019 — Feature-level DoD § Scenario 3 (bookingLimits.maxPerDay)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('cliente com agendamento no dia + maxPerDay=1 → modal de reagendamento', async ({
      org,
      authedPage,
    }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!
      const memberOperationId = org.memberOperationIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Limite',
        durationMinutes: 30,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkMemberOperationToServices(org.orgId, memberOperationId, [serviceId])

      const customerId = await seedCustomerShadowForUser(org.orgId, org.uid)
      await seedSubscription(org.orgId, customerId, {
        planName: 'Plano Anti-Vaga',
        bookingLimits: { maxPerDay: 1 },
      })

      const targetDate = nextWeekday('Wed')
      const existingStart = `${targetDate}T12:00:00.000Z`
      const existingEnd = `${targetDate}T12:30:00.000Z`
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        memberOperationId,
        customerId,
        serviceId,
        startAt: existingStart,
        endAt: existingEnd,
      })

      const proposedStart = `${targetDate}T17:00:00.000Z`
      const params = new URLSearchParams({
        service: serviceId,
        memberOperation: memberOperationId,
        start: proposedStart,
      })
      const booking = new PublicBookingPage(authedPage, slug)
      await authedPage.goto(`/${slug}/unidade-1/book?${params.toString()}`)
      await expect(booking.confirmHeading()).toBeVisible()

      await booking.confirmButton().click()
      const dialog = authedPage.getByRole('dialog', {
        name: /você já tem um agendamento neste dia/i,
      })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('link', { name: 'Reagendar' })).toHaveAttribute(
        'href',
        '/me/appointments',
      )

      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/book\\?`))
    })
  },
)
