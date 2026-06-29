import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import { seedService, signInAndAttachSession } from '../helpers/session'
import { orgSlug } from '../pages'

// Issue #843 + brief 0077 DoD Cenário 4 — Anti-double-book server-side.
//
// Two LOGGED-IN browser contexts submit the same slot concurrently (login is
// mandatory since #1275 — anonymous booking no longer exists). The transactional
// booking commit must serialize them: one ends with the success card, the other
// gets the "horário já está ocupado" error. Whichever context wins is an
// implementation detail — the spec only asserts the 1-success / 1-failure split.
//
// Both contexts authenticate as the same completed user; the per-org Customer is
// derived from the uid, so they race for the SAME slot as the same subject — the
// exclusion constraint, not a per-user guard, is what serializes them.

async function fillBookingForm(page: Page, slug: string, startAtLocal: string): Promise<void> {
  await page.goto(`/${slug}/book`)
  await chooseOptionByIndex(page, /serviço/i, 0)
  await chooseOptionByIndex(page, /profissional/i, 0)
  await page.getByRole('textbox', { name: /data e horário/i }).fill(startAtLocal)
  // No PII inputs since #1275 — service/pro/datetime only.
}

test.describe('Landing pública — anti-duplo-agendamento', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

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
    await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      publicVisible: true,
      unitIds: org.unitIds,
    })

    // Slot 4 days ahead at 14:00 local — clear of `Date.now()` and any other
    // public-booking spec's clock arithmetic.
    const target = new Date(Date.now() + 4 * 24 * 60 * 60_000)
    const yyyy = target.getUTCFullYear()
    const mm = String(target.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(target.getUTCDate()).padStart(2, '0')
    const startAtLocal = `${yyyy}-${mm}-${dd}T14:00`

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

    await Promise.all([
      fillBookingForm(pageA, slug, startAtLocal),
      fillBookingForm(pageB, slug, startAtLocal),
    ])

    // Submit both as close to simultaneously as `Promise.all` allows.
    await Promise.all([
      pageA.getByRole('button', { name: /^entrar e agendar$/i }).click(),
      pageB.getByRole('button', { name: /^entrar e agendar$/i }).click(),
    ])

    // Wait for either the success card or the conflict error on both pages.
    await Promise.all([
      expect(pageA.getByText(/Agendamento confirmado|já está ocupado/)).toBeVisible(),
      expect(pageB.getByText(/Agendamento confirmado|já está ocupado/)).toBeVisible(),
    ])

    // Exactly one success + exactly one conflict across the two pages — asserted
    // by summing across both pages, so we never branch on which one won.
    const successCount =
      (await pageA.getByText(/Agendamento confirmado/).count()) +
      (await pageB.getByText(/Agendamento confirmado/).count())
    const conflictCount =
      (await pageA.getByText(/já está ocupado/i).count()) +
      (await pageB.getByText(/já está ocupado/i).count())
    expect(successCount).toBe(1)
    expect(conflictCount).toBe(1)
  })
})
