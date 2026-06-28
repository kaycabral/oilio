import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

// Issue #844 — Self-book wizard (Serviço → Slot → Confirmação).
//
// Walks the full flow:
//   1. `/{orgSlug}/{unitSlug}` — pick service (#841 deliverable, reused).
//   2. `/{orgSlug}/{unitSlug}/availability?service=…` — pick slot
//      (#842 deliverable, reused).
//   3. `/{orgSlug}/{unitSlug}/book?service=&start=&memberOperation=` —
//      confirm contact details, submit.
//   4. `/{orgSlug}/{unitSlug}/book/success?appt=…` — confirmation page.
//
// Anonymous flow (no OAuth gate yet — tracked as follow-up to #844 since
// the dedupe-by-WA path that #832/865 will leverage is still the wizard's
// contract for now).

test.describe('Wizard de auto-agendamento (#844)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test(
    'caminho feliz: catálogo → disponibilidade → confirmação → sucesso',
    { tag: '@critical' },
    async ({ org, page }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Premium',
        durationMinutes: 30,
        priceCents: 6500,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

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
      const firstSlot = booking.slotByMemberOperation(/profissional 1/i).first()
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
    org,
    page,
  }) => {
    const slug = orgSlug(org.orgId)
    await seedService(org.orgId, {
      name: 'Corte',
      publicVisible: true,
      unitIds: [org.unitIds[0]!],
    })
    // The wizard URL with no `service` param redirects to the catalog.
    await page.goto(`/${slug}/unidade-1/book`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1$`))
  })

  test('/book com serviço mas sem start redireciona pra disponibilidade (fallback do passo 2)', async ({
    org,
    page,
  }) => {
    const slug = orgSlug(org.orgId)
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      publicVisible: true,
      unitIds: [org.unitIds[0]!],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    await page.goto(`/${slug}/unidade-1/book?service=${serviceId}`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/availability\\?service=`))
  })
})
