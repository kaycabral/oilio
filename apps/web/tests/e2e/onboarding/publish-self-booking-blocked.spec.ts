import { expect, test } from '../fixtures'
import { orgSlug } from '../pages'

// #988 (brief 0008, Grupo C) — rewritten for the inferred-availability model
// (spike): there is NO global "publish" button anymore. A unit in "Por
// agendamento" mode goes live automatically once it has business hours
// (isUnitBookable = appointment mode + businessHours). The per-unit card
// (UnitPublishCard) is FEEDBACK — it tells the owner whether the agenda is
// visible and exactly what's still missing (hours, public service, approved
// memberOperation). Nothing in the app is "blocked"; an unmet requirement simply
// keeps the unit off the public surface.
//
// AC-06 [critical] [smoke] — a not-yet-bookable unit shows the readiness
//   checklist with the missing items called out, and its public surface stays
//   offline (404) while the minimum (hours) is missing.

test.describe(
  'Publish self-booking — not bookable without the minimum (#988)',
  { tag: '@critical' },
  () => {
    // Degenerate unit: appointment mode (seed default) but no hours/address, no
    // public service, no approved memberOperation → the unit is NOT bookable.
    test.use({
      orgInput: {
        hasBusinessHours: false,
        memberOperationCount: 0,
      },
    })

    test('AC-06: the per-unit readiness card lists the missing items', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto(`/units/${org.unitIds[0]!}`)

      // The per-unit publish card renders (the unit is in appointment mode).
      await expect(authedPage.getByText('Agendamento público desta unidade')).toBeVisible()

      // It tells the owner the agenda is NOT live yet (inferred — no button).
      await expect(authedPage.getByText(/fica visível automaticamente/i)).toBeVisible()

      // The checklist surfaces each unmet requirement. With a hours-less unit,
      // no public service and no approved pro, all three are missing.
      const checklist = authedPage.locator('[data-slot="unit-agenda-readiness"]')
      await expect(
        checklist.getByText('Endereço e horário de funcionamento preenchidos'),
      ).toBeVisible()
      await expect(checklist.getByText('1 serviço público oferecido nesta unidade')).toBeVisible()
      await expect(checklist.getByText('1 profissional aprovado nesta unidade')).toBeVisible()
    })

    test('AC-08 (negative): the public page does not resolve while the unit is not bookable', async ({
      org,
      page,
    }) => {
      const slug = orgSlug(org.orgId)

      // Landing: no bookable unit → getPublicOrgSummary returns null → 404.
      const landing = await page.goto(`/${slug}`)
      expect(landing?.status()).toBe(404)

      // Per-unit page: isUnitBookable(unit) is false → getPublicUnitBundle null → 404.
      const unit = await page.goto(`/${slug}/unidade-1`)
      expect(unit?.status()).toBe(404)
    })
  },
)
