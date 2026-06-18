import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkProfessionalToServices,
  seedAppointment,
  seedCustomer,
  seedService,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

// Issue #842 — Calendário público de slots disponíveis.

test.describe('Landing pública — calendário de disponibilidade', () => {
  test.describe('com serviço selecionado', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('anônimo lê /[slug]/[unitSlug]/availability com grid + filtros', async ({ org, page }) => {
      const unitId = org.unitIds[0]!
      const serviceId = seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })
      linkProfessionalToServices(org.orgId, org.professionalIds[0]!, [serviceId])

      const targetDate = nextWeekday('Wed')

      // Pre-block 09:00 BR (12:00 UTC) with an existing appointment so that slot
      // is dropped — we can assert both presence (other slots) and absence (09:00).
      const cust = seedCustomer(org.orgId, { name: 'Bloqueado', whatsapp: '11900000000' })
      seedAppointment({
        orgId: org.orgId,
        unitId,
        professionalId: org.professionalIds[0]!,
        customerId: cust,
        serviceId,
        startAt: `${targetDate}T12:00:00.000Z`,
        endAt: `${targetDate}T12:30:00.000Z`,
        status: 'scheduled',
      })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(page.getByRole('heading', { name: /disponibilidade/i })).toBeVisible()

      // 09:30 (and later) BR slots stay available; 09:00 is blocked.
      await expect(page.getByText('09:30').first()).toBeVisible()
      await expect(page.getByText('10:00').first()).toBeVisible()
      await expect(page.getByText('09:00').first()).toHaveCount(0)
    })
  })

  test.describe('sem serviço', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('página de disponibilidade sem ?service= mostra orientação', async ({ org, page }) => {
      await page.goto(`/${orgSlug(org.orgId)}/unidade-1/availability`)
      await expect(page.getByText(/selecione um serviço no catálogo/i)).toBeVisible()
    })
  })
})
