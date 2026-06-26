// Regression — a org with ZERO active units must stay navigable (no crash).
//
// Reported by the owner: after deleting every unit, opening any operational
// surface (agenda / orders / …) crashed. resolveActiveUnit already returns
// activeUnitId=null for an empty org; the crash is downstream in a page/
// component that assumed a unit exists. Two shapes are covered:
//   (1) a fresh org that never had a unit;
//   (2) a org that HAD a unit with data (appointment + open order), then
//       archived it (the real-world flow that triggered the report) — a page
//       must not crash resolving the now-archived unit referenced by that data.

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { seedAppointment, seedCustomer, seedOpenOrder, seedUnit } from '../helpers/session'

async function assertNoCrash(authedPage: Page, path: string) {
  const res = await authedPage.goto(path)
  expect(res?.status() ?? 0, `${path} returned a server error`).toBeLessThan(500)
  await expect(authedPage.getByText('Application error')).toHaveCount(0)
  await expect(authedPage.getByText(/Unhandled Runtime Error/)).toHaveCount(0)
}

// PRD Identidade v2 / F5: the old "Empresa" page retired → `/company` now
// redirects to `/organizations` (the Negócios & Unidades surface; route is the English
// domain term, "Negócios" is the label only). Sweep the v2 route.
const SURFACES = [
  '/agenda',
  '/orders',
  '/dashboard',
  '/catalog',
  '/customers',
  '/reports',
  '/team',
  '/plans',
  '/subscriptions',
  '/organizations',
  '/units',
]

test.describe('Org sem unidades — app navegável (regressão)', { tag: '@critical' }, () => {
  test.describe('nunca teve unidade', () => {
    test.use({ orgInput: { unitCount: 0 } })
    for (const path of SURFACES) {
      test(`${path} renderiza sem crash`, async ({ authedPage }) => {
        // PRD Identidade v2 / brief 0046: a 0-unit owner is NOT gated — every
        // surface renders normally (empty-states where data is unit-scoped),
        // never a crash. The no-crash guarantee (status < 500, no error overlay)
        // is what matters.
        await assertNoCrash(authedPage, path)
      })
    }

    // The reported crash: with no unit, opening an operational surface must not
    // throw an unhandled error. In v2 there is NO first-unit gate (PRD Identidade
    // v2 — simplification): a 0-unit owner lands on the surface normally, which
    // renders an empty-state ("Nenhuma unidade ativa") instead of crashing.
    test('sem unidade não crasha; renderiza empty-state sem unidade ativa', async ({
      authedPage,
    }) => {
      await authedPage.goto('/orders')
      await expect(authedPage).toHaveURL(/\/orders$/)
      await expect(authedPage.getByText('Nenhuma unidade ativa')).toBeVisible()
      await expect(authedPage.getByText('Application error')).toHaveCount(0)
      await expect(authedPage.getByText(/Unhandled Runtime Error/)).toHaveCount(0)
    })
  })

  test.describe('tinha unidade com dados, depois arquivada', () => {
    // Zero ACTIVE units: the org's only unit is seeded already-archived (post-
    // cutover there is no in-place archive PATCH; `seedUnit({ archivedAt })`
    // reproduces the SAME resolved state the reported flow ended in — a unit
    // referenced by data that is no longer active). A professional with no unit
    // link is enough for the appointment FK resolution.
    test.use({ orgInput: { unitCount: 0, professionalCount: 1 } })

    test('agenda/orders/dashboard não crasham após arquivar a única unidade', async ({
      org,
      authedPage,
    }) => {
      const unitId = await seedUnit(org.orgId, { archivedAt: new Date().toISOString() })
      const customerId = await seedCustomer(org.orgId, { name: `Cliente NU ${Date.now()}` })
      const start = new Date(Date.now() + 86_400_000).toISOString()
      // The data references a unit that is archived (the reported flow's end state).
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        professionalId: org.professionalIds[0]!,
        customerId,
        serviceId: 'e2e-svc',
        startAt: start,
        endAt: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
        status: 'scheduled',
      })
      await seedOpenOrder({ orgId: org.orgId, unitId, customerId, attributedUserId: org.uid })

      for (const path of SURFACES) {
        await assertNoCrash(authedPage, path)
      }
    })
  })
})
