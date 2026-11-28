import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe('Wizard de auto-agendamento (#844)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test(
    'caminho feliz: catálogo → disponibilidade → confirmação → sucesso',
    { tag: '@critical' },
    async ({ org, authedPage }) => {
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

      await booking.gotoCatalog()
      await expect(booking.serviceCard('Corte Premium')).toBeVisible()
      await booking.serviceCard('Corte Premium').click()
      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/availability\\?`))

      const targetDate = nextWeekday('Wed')
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      const firstSlot = booking.slotByMemberOperation(/profissional 1/i).first()
      await firstSlot.click()

      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/book\\?`))
      await expect(booking.confirmHeading()).toBeVisible()
      await expect(authedPage.getByText(/Corte Premium/).filter({ visible: true })).toBeVisible()
      await expect(booking.bookingAsNotice()).toBeVisible()
      await booking.confirmButton().click()

      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/book/success\\?appt=`))
      await expect(booking.successHeading()).toBeVisible()
      await expect(authedPage.getByText(/Corte Premium/).filter({ visible: true })).toBeVisible()
      await expect(authedPage.getByText(/Profissional 1/).filter({ visible: true })).toBeVisible()
      await expect(authedPage.getByText(/R\$\s*65,00/).filter({ visible: true })).toBeVisible()
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
