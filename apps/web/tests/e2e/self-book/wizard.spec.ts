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
//      confirm + submit. Since brief 0077 (#1275) login is REQUIRED and the
//      confirm step carries NO PII — the Customer is derived from the uid.
//   4. `/{orgSlug}/{unitSlug}/book/success?appt=…` — confirmation page.

test.describe('Wizard de auto-agendamento (#844)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test(
    'caminho feliz: catálogo → disponibilidade → confirmação → sucesso',
    { tag: '@critical' },
    async ({ org, authedPage }) => {
      // Logged-in + completed visitor (the seeded owner is a surrogate —
      // completionCompleted=true). Login is mandatory since #1275.
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

      const booking = new PublicBookingPage(authedPage, slug)

      // Step 1: catalog → click the service.
      await booking.gotoCatalog()
      await expect(booking.serviceCard('Corte Premium')).toBeVisible()
      await booking.serviceCard('Corte Premium').click()
      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/availability\\?`))

      // Step 2: availability for that service. The default date is "today" and
      // BR business hours are 09–18; if the test runs after 18 BR, today's grid
      // is empty. Jump to the next weekday explicitly so the spec is
      // wall-clock-independent.
      const targetDate = nextWeekday('Wed')
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      const firstSlot = booking.slotByMemberOperation(/profissional 1/i).first()
      await firstSlot.click()

      // Step 3: confirm step — no PII inputs, just "Agendando como <nome>" + a
      // one-click confirm (the Customer is derived from the authenticated uid).
      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/book\\?`))
      await expect(booking.confirmHeading()).toBeVisible()
      await expect(authedPage.getByText(/Corte Premium/)).toBeVisible()
      await expect(booking.bookingAsNotice()).toBeVisible()
      await booking.confirmButton().click()

      // Step 4: success page with snapshot details.
      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/book/success\\?appt=`))
      await expect(booking.successHeading()).toBeVisible()
      await expect(authedPage.getByText(/Corte Premium/)).toBeVisible()
      await expect(authedPage.getByText(/Profissional 1/)).toBeVisible()
      await expect(authedPage.getByText(/R\$\s*65,00/)).toBeVisible()
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
