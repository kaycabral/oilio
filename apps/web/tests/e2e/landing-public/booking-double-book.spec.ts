import type { BrowserContext } from '@playwright/test'
import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import { seedService } from '../helpers/session'
import { orgSlug } from '../pages'

// Issue #843 — Anti-double-book server-side.
//
// Two anonymous browser contexts (no shared cookies/session) submit the
// same slot concurrently. The transactional booking commit must serialize
// them: one ends with the success card, the other gets the "horário já
// está ocupado" error. Whichever context wins is implementation-detail —
// the spec only asserts the 1-success / 1-failure split.

async function fillBookingForm(ctx: BrowserContext, slug: string, startAtLocal: string) {
  const page = await ctx.newPage()
  await page.goto(`/${slug}/book`)
  await chooseOptionByIndex(page, /serviço/i, 0)
  await chooseOptionByIndex(page, /profissional/i, 0)
  await page.getByRole('textbox', { name: /data e horário/i }).fill(startAtLocal)
  await page.getByRole('textbox', { name: /seu nome/i }).fill(`Cliente ${Math.random()}`)
  await page
    .getByRole('textbox', { name: /whatsapp/i })
    .fill(`119${Math.floor(10000000 + Math.random() * 89999999)}`)
  return page
}

test.describe('Landing pública — anti-duplo-agendamento', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  // Contexts created by the concurrent-booking test, torn down after each test
  // (replaces an in-test try/finally, which the lint bans as conditional-in-test).
  const openContexts: BrowserContext[] = []

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((ctx) => ctx.close()))
  })

  test('dois landings simultâneos no mesmo slot — exatamente um ganha', async ({
    org,
    browser,
  }) => {
    const slug = orgSlug(org.orgId)
    seedService(org.orgId, {
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

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    openContexts.push(ctxA, ctxB)

    const [pageA, pageB] = await Promise.all([
      fillBookingForm(ctxA, slug, startAtLocal),
      fillBookingForm(ctxB, slug, startAtLocal),
    ])

    // Submit both as close to simultaneously as `Promise.all` allows.
    await Promise.all([
      pageA.getByRole('button', { name: /^solicitar agendamento$/i }).click(),
      pageB.getByRole('button', { name: /^solicitar agendamento$/i }).click(),
    ])

    // Wait for either the success card or the conflict error on both pages.
    await Promise.all([
      expect(pageA.getByText(/Agendamento solicitado|já está ocupado/)).toBeVisible(),
      expect(pageB.getByText(/Agendamento solicitado|já está ocupado/)).toBeVisible(),
    ])

    // Exactly one success + exactly one conflict across the two pages — asserted
    // by summing across both pages, so we never branch on which one won.
    const successCount =
      (await pageA.getByText(/Agendamento solicitado/).count()) +
      (await pageB.getByText(/Agendamento solicitado/).count())
    const conflictCount =
      (await pageA.getByText(/já está ocupado/i).count()) +
      (await pageB.getByText(/já está ocupado/i).count())
    expect(successCount).toBe(1)
    expect(conflictCount).toBe(1)
  })
})
