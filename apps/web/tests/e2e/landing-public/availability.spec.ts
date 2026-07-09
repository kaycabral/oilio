import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe('Landing pública — calendário de disponibilidade', () => {
  test.describe('com serviço selecionado', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('anônimo lê /[slug]/[unitSlug]/availability com grid + filtros', async ({ org, page }) => {
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

      const targetDate = nextWeekday('Wed')

      const cust = await seedCustomer(org.orgId, { name: 'Bloqueado', mobile: uniqueWhatsapp() })
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        memberOperationId: org.memberOperationIds[0]!,
        customerId: cust,
        serviceId,
        startAt: `${targetDate}T12:00:00.000Z`,
        endAt: `${targetDate}T12:30:00.000Z`,
        status: 'scheduled',
      })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(page.getByRole('heading', { name: /escolha data e horário/i })).toBeVisible()

      await expect(page.getByText('09:30').first()).toBeVisible()
      await expect(page.getByText('10:00').first()).toBeVisible()
      await expect(page.getByText('09:00').first()).toHaveCount(0)
    })
  })

  test.describe('sem serviço', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('página de disponibilidade sem ?service= mostra orientação', async ({ org, page }) => {
      await page.goto(`/${orgSlug(org.orgId)}/unidade-1/availability`)
      await expect(page.getByText(/selecione um serviço no catálogo/i)).toBeVisible()
    })
  })
})
