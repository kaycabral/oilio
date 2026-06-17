import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { linkProfessionalToServices, seedService } from '../helpers/session'
import { PublicBookingPage, tenantSlug } from '../pages'

// Issue #844 — Self-book wizard (Serviço → Slot → Confirmação).
//
// Walks the full flow:
//   1. `/{tenantSlug}/{unitSlug}` — pick service (#841 deliverable, reused).
//   2. `/{tenantSlug}/{unitSlug}/availability?service=…` — pick slot
//      (#842 deliverable, reused).
//   3. `/{tenantSlug}/{unitSlug}/book?service=&start=&professional=` —
//      confirm contact details, submit.
//   4. `/{tenantSlug}/{unitSlug}/book/success?appt=…` — confirmation page.
//
// Anonymous flow (no OAuth gate yet — tracked as follow-up to #844 since
// the dedupe-by-WA path that #832/865 will leverage is still the wizard's
// contract for now).

test.describe('Wizard de auto-agendamento (#844)', () => {
  test.use({ tenantInput: { unitCount: 1, professionalCount: 1 } })

  test(
    'caminho feliz: catálogo → disponibilidade → confirmação → sucesso',
    { tag: '@critical' },
    async ({ tenant, page }) => {
      const slug = tenantSlug(tenant.tenantId)
      const unitId = tenant.unitIds[0]!
      const serviceId = seedService(tenant.tenantId, {
        name: 'Corte Premium',
        durationMinutes: 30,
        priceCents: 6500,
        publicVisible: true,
        unitIds: [unitId],
      })
      linkProfessionalToServices(tenant.tenantId, tenant.professionalIds[0]!, [serviceId])

      const booking = new PublicBookingPage(page, slug)

      // Step 1: catalog → click the service.
      await booking.gotoCatalog()
      await expect(booking.serviceCard('Corte Premium')).toBeVisible()
      await booking.serviceCard('Corte Premium').click()
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/availability\\?`))

      // Step 2: availability for that service. The default date is "today" and
      // BR business hours are 09–18; if the test runs after 18 BR, today's grid
      // is empty. Jump to the next weekday explicitly so the spec is
      // wall-clock-independent.
      const targetDate = nextWeekday('Wed')
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      const firstSlot = booking.slotByProfessional(/profissional 1/i).first()
      await firstSlot.click()

      // Step 3: confirm form pre-filled with service/pro/start.
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/book\\?`))
      await expect(booking.confirmHeading()).toBeVisible()
      await expect(page.getByText(/Corte Premium/)).toBeVisible()
      await booking.fillContact({
        name: 'Joana Cliente',
        whatsapp: `119${Math.floor(10000000 + Math.random() * 89999999)}`,
      })
      await booking.confirmButton().click()

      // Step 4: success page with snapshot details.
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/book/success\\?appt=`))
      await expect(booking.successHeading()).toBeVisible()
      await expect(page.getByText(/Corte Premium/)).toBeVisible()
      await expect(page.getByText(/Profissional 1/)).toBeVisible()
      await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
    },
  )

  test('/book sem serviço redireciona pra catálogo (fallback do passo 1)', async ({
    tenant,
    page,
  }) => {
    const slug = tenantSlug(tenant.tenantId)
    seedService(tenant.tenantId, {
      name: 'Corte',
      publicVisible: true,
      unitIds: [tenant.unitIds[0]!],
    })
    // The wizard URL with no `service` param redirects to the catalog.
    await page.goto(`/${slug}/unidade-1/book`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1$`))
  })

  test('/book com serviço mas sem start redireciona pra disponibilidade (fallback do passo 2)', async ({
    tenant,
    page,
  }) => {
    const slug = tenantSlug(tenant.tenantId)
    const serviceId = seedService(tenant.tenantId, {
      name: 'Corte',
      publicVisible: true,
      unitIds: [tenant.unitIds[0]!],
    })
    linkProfessionalToServices(tenant.tenantId, tenant.professionalIds[0]!, [serviceId])

    await page.goto(`/${slug}/unidade-1/book?service=${serviceId}`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/availability\\?service=`))
  })
})
