import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedService,
  signInAndAttachSession,
} from '../helpers/session'
import { orgSlug, PublicBookingPage } from '../pages'

// Issue #843 + brief 0077 DoD Cenário 4 — Anti-double-book server-side.
//
// Two LOGGED-IN browser contexts pick the SAME availability slot concurrently
// (login is mandatory since #1275 — anonymous booking no longer exists). The
// transactional booking commit must serialize them: one ends with the success
// card, the other gets the "não está mais disponível" error. Whichever context
// wins is an implementation detail — the spec only asserts the 1-success /
// 1-failure split.
//
// Both contexts authenticate as the same completed user; the per-org Customer is
// derived from the uid, so they race for the SAME slot as the same subject — the
// exclusion constraint, not a per-user guard, is what serializes them.

// Drive a context through the per-unit wizard up to (but not clicking) confirm:
// availability for a fixed day → click the first slot of the seeded pro. Both
// contexts target the same day/pro, so they land on the same slot.
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

  // Contexts created by the concurrent-booking test, torn down after each test
  // (replaces an in-test try/finally, which the lint bans as conditional-in-test).
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

    // Two authenticated contexts (login required since #1275).
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

    // Submit both as close to simultaneously as `Promise.all` allows.
    await Promise.all([bookingA.confirmButton().click(), bookingB.confirmButton().click()])

    // The winner navigates to the success page (/book/success); the loser stays on
    // the confirm form showing the "não está mais disponível" conflict. Wait for
    // each page to settle into one of those two terminal states.
    const settled = (page: Page) =>
      Promise.race([
        page.waitForURL(/\/book\/success\?appt=/, { timeout: 15_000 }),
        page.getByText(/não está mais disponível/i).waitFor({ state: 'visible', timeout: 15_000 }),
      ])
    await Promise.all([settled(pageA), settled(pageB)])

    // Exactly one success + exactly one conflict across the two pages — asserted
    // by summing across both pages, so we never branch on which one won.
    const successCount = [pageA, pageB].filter((p) => p.url().includes('/book/success')).length
    const conflictCount =
      (await pageA.getByText(/não está mais disponível/i).count()) +
      (await pageB.getByText(/não está mais disponível/i).count())
    expect(successCount).toBe(1)
    expect(conflictCount).toBe(1)
  })
})
