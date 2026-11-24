import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedService,
  signInAndAttachSession,
} from '../helpers/session'
import { orgSlug, PublicBookingPage } from '../pages'

async function pickSameSlot(page: Page, slug: string, serviceId: string): Promise<void> {
  const booking = new PublicBookingPage(page, slug)
  await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
  await booking
    .slotByMemberOperation(/profissional 1/i)
    .first()
    .click()
  await expect(booking.confirmButton()).toBeVisible()
}

test.describe('Landing pública — anti-duplo-agendamento', { tag: '@critical' }, () => {
  test.use({
    orgInput: { unitCount: 1, memberOperationCount: 1, hasBusinessHours: true, slotMinutes: 30 },
  })

  const openContexts: BrowserContext[] = []

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((ctx) => ctx.close()))
  })

  test('dois landings simultâneos no mesmo slot — exatamente um ganha', async ({
    org,
    browser,
    baseURL,
  }) => {
    const slug = orgSlug(org.orgId)
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      publicVisible: true,
      unitIds: org.unitIds,
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    openContexts.push(ctxA, ctxB)
    await Promise.all([
      signInAndAttachSession(ctxA, org.email, org.password, baseURL ?? undefined),
      signInAndAttachSession(ctxB, org.email, org.password, baseURL ?? undefined),
    ])
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    await Promise.all([pickSameSlot(pageA, slug, serviceId), pickSameSlot(pageB, slug, serviceId)])

    const bookingA = new PublicBookingPage(pageA, slug)
    const bookingB = new PublicBookingPage(pageB, slug)

    await Promise.all([bookingA.confirmButton().click(), bookingB.confirmButton().click()])

    const settled = (page: Page) =>
      Promise.race([
        page.waitForURL(/\/book\/success\?appt=/, { timeout: 15_000 }),
        page.getByText(/não está mais disponível/i).waitFor({ state: 'visible', timeout: 15_000 }),
      ])
    await Promise.all([settled(pageA), settled(pageB)])

    const successCount = [pageA, pageB].filter((p) => p.url().includes('/book/success')).length
    const conflictCount =
      (await pageA.getByText(/não está mais disponível/i).count()) +
      (await pageB.getByText(/não está mais disponível/i).count())
    expect(successCount).toBe(1)
    expect(conflictCount).toBe(1)
  })
})
