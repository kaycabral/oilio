import { expect, test } from '../fixtures'
import { checkStable, fillStable } from '../helpers/hydration'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

// #988 (brief 0008, Grupo C) — rewritten for the inferred-availability model
// (spike): there is NO "publish" button. A unit goes live automatically once
// it is bookable — appointment mode (seed default) + business hours. The owner
// makes it live by filling the unit's hours in the real edit form; the public
// page then resolves (200) and the per-unit card flips to "No ar".
//
// AC-07 [critical] — completing the unit's hours via the real UI makes it
//   bookable (isUnitBookable) — no manual publish step.
// AC-08 [critical] — bookable → public catalog reachable by slug, listing the
//   unit's public service.

test.describe('Publish self-booking — happy path (#988)', { tag: '@critical' }, () => {
  // Unit missing ONLY its hours/address (appointment mode, approved pro, public
  // service added below) → not bookable yet. The owner fills the hours to go live.
  test.use({
    orgInput: {
      hasBusinessHours: false,
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
    },
  })

  test('AC-07/AC-08: filling the unit hours makes it bookable → public page live', async ({
    org,
    authedPage,
    page,
  }) => {
    const slug = orgSlug(org.orgId)
    const unitId = org.unitIds[0]!

    // A public service linked to the unit + an approved memberOperation execute
    // it — so once the unit is bookable, the catalog has a card to show.
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Publicado',
      priceCents: 5000,
      publicVisible: true,
      unitIds: [unitId],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    // Before: the unit is not bookable (no hours) → public surface is 404.
    const before = await page.goto(`/${slug}/unidade-1`)
    expect(before?.status()).toBe(404)

    // Stub the CEP lookup (external brasilapi) so the address fill is
    // deterministic; the form flow stays real (populates address + reveals
    // the number field).
    await authedPage.route('**/api/postal-code/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          postalCode: '01310100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Avenida Paulista',
        }),
      }),
    )

    // Go live through the REAL edit form: fill address + enable a weekday in
    // the appointment-mode hours, then save. No "publish" button exists.
    await authedPage.goto(`/units/${unitId}`)

    // The per-unit card shows the agenda is not live yet (hours missing).
    await expect(authedPage.getByText('Agendamento público desta unidade')).toBeVisible()
    await expect(authedPage.getByText(/fica visível automaticamente/i)).toBeVisible()

    // Controlled inputs/switch — fill/toggle resiliently against the
    // pre-hydration drop under parallel load (see helpers/hydration).
    await fillStable(authedPage.locator('input[name="postalCode"]'), '01310100')
    await fillStable(authedPage.locator('input[name="number"]'), '123')

    // Enable Monday's booking window (appointment mode is the seed default;
    // toggling a day seeds its default 09:00–18:00 interval).
    await checkStable(authedPage.locator('#bh_monday'))
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    // Wait for the save (useTransition) to finish before reloading, else the
    // re-navigation can read the unit before the hours were persisted.
    await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
      timeout: 10_000,
    })

    // After save, the card flips to the live state ("No ar — clientes já
    // podem agendar"). Re-navigate to read the fresh server render.
    await authedPage.goto(`/units/${unitId}`)
    await expect(authedPage.getByText(/no ar — clientes já podem agendar/i)).toBeVisible({
      timeout: 5000,
    })

    // AC-08: the public per-unit catalog now resolves and lists the service.
    const booking = new PublicBookingPage(page, slug)
    const after = await page.goto(`/${slug}/unidade-1`)
    expect(after?.status()).toBe(200)
    await expect(booking.serviceCard('Corte Publicado')).toBeVisible()
  })
})
