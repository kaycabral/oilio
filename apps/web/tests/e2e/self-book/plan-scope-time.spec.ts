import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedCustomerShadowForUser,
  seedService,
  seedSubscription,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe(
  'brief 0019 — Feature-level DoD § Scenario 2 (allowedTimeScope)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('plano com horário restrito filtra slots no calendar e bloqueia commit', async ({
      org,
      authedPage,
      browser,
    }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Tempo',
        durationMinutes: 30,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

      const customerId = await seedCustomerShadowForUser(org.orgId, org.uid)
      await seedSubscription(org.orgId, customerId, {
        planName: 'Plano Janela Curta',
        allowedTimeScope: {
          daysOfWeek: [1, 2, 3, 4, 5],
          hourRange: { start: '09:00', end: '10:00' },
        },
      })

      const targetDate = nextWeekday('Wed')

      const subscribed = new PublicBookingPage(authedPage, slug)
      await subscribed.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(authedPage.getByText('09:00')).toBeVisible()
      await expect(authedPage.getByText('11:00')).toHaveCount(0)
      await expect(authedPage.getByText('14:00')).toHaveCount(0)
      await expect(
        authedPage.getByRole('note', { name: 'Seu plano cobre', exact: true }),
      ).toBeVisible()

      const guestContext = await browser.newContext()
      const guestPage = await guestContext.newPage()
      const guest = new PublicBookingPage(guestPage, slug)
      await guest.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(guestPage.getByText('09:00')).toBeVisible()
      await expect(guestPage.getByText('14:00')).toBeVisible()
      await guestContext.close()

      const outOfScopeStart = buildLocalIso(targetDate, '14:00', org.orgId)
      const params = new URLSearchParams({
        service: serviceId,
        memberOperation: org.memberOperationIds[0]!,
        start: outOfScopeStart,
      })
      await authedPage.goto(`/${slug}/unidade-1/book?${params.toString()}`)
      await subscribed.confirmButton().click()
      await expect(authedPage.getByRole('link', { name: 'Falar no WhatsApp' })).toBeVisible()
    })
  },
)

function buildLocalIso(dateYmd: string, hhmm: string, _orgId: string): string {
  const [hh, mm] = hhmm.split(':')
  if (hh === undefined || mm === undefined) {
    throw new Error(`invalid HH:mm time: ${hhmm}`)
  }
  const localHour = Number(hh)
  const utcHour = (localHour + 3) % 24
  return `${dateYmd}T${String(utcHour).padStart(2, '0')}:${mm}:00.000Z`
}
