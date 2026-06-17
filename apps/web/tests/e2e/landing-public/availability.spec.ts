import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkProfessionalToServices,
  seedAppointment,
  seedCustomer,
  seedService,
} from '../helpers/session'
import { PublicBookingPage, tenantSlug } from '../pages'

// Issue #842 — Calendário público de slots disponíveis.

test.describe('Landing pública — calendário de disponibilidade', () => {
  test.describe('com serviço selecionado', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 1 } })

    test('anônimo lê /[slug]/[unitSlug]/availability com grid + filtros', async ({
      tenant,
      page,
    }) => {
      const unitId = tenant.unitIds[0]!
      const serviceId = seedService(tenant.tenantId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })
      linkProfessionalToServices(tenant.tenantId, tenant.professionalIds[0]!, [serviceId])

      const targetDate = nextWeekday('Wed')

      // Pre-block 09:00 BR (12:00 UTC) with an existing appointment so that slot
      // is dropped — we can assert both presence (other slots) and absence (09:00).
      const cust = seedCustomer(tenant.tenantId, { name: 'Bloqueado', whatsapp: '11900000000' })
      seedAppointment({
        tenantId: tenant.tenantId,
        unitId,
        professionalId: tenant.professionalIds[0]!,
        customerId: cust,
        serviceId,
        startAt: `${targetDate}T12:00:00.000Z`,
        endAt: `${targetDate}T12:30:00.000Z`,
        status: 'scheduled',
      })

      const booking = new PublicBookingPage(page, tenantSlug(tenant.tenantId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(page.getByRole('heading', { name: /disponibilidade/i })).toBeVisible()

      // 09:30 (and later) BR slots stay available; 09:00 is blocked.
      await expect(page.getByText('09:30').first()).toBeVisible()
      await expect(page.getByText('10:00').first()).toBeVisible()
      await expect(page.getByText('09:00').first()).toHaveCount(0)
    })
  })

  test.describe('sem serviço', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 1 } })

    test('página de disponibilidade sem ?service= mostra orientação', async ({ tenant, page }) => {
      await page.goto(`/${tenantSlug(tenant.tenantId)}/unidade-1/availability`)
      await expect(page.getByText(/selecione um serviço no catálogo/i)).toBeVisible()
    })
  })
})
