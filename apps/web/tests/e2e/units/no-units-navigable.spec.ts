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
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedAppointment, seedCustomer, seedOpenOrder } from '../helpers/session'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

function archiveUnit(orgId: string, unitId: string): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/orgs/${orgId}/units/${unitId}?updateMask.fieldPaths=archivedAt`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { archivedAt: { stringValue: new Date().toISOString() } } }),
    ],
    { stdio: 'pipe' },
  )
}

async function assertNoCrash(authedPage: Page, path: string) {
  const res = await authedPage.goto(path)
  expect(res?.status() ?? 0, `${path} returned a server error`).toBeLessThan(500)
  await expect(authedPage.getByText('Application error')).toHaveCount(0)
  await expect(authedPage.getByText(/Unhandled Runtime Error/)).toHaveCount(0)
}

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
  '/company',
  '/units',
]

test.describe('Org sem unidades — app navegável (regressão)', { tag: '@critical' }, () => {
  test.describe('nunca teve unidade', () => {
    test.use({ orgInput: { unitCount: 0 } })
    for (const path of SURFACES) {
      test(`${path} renderiza sem crash`, async ({ authedPage }) => {
        await assertNoCrash(authedPage, path)
      })
    }

    // The reported crash: clicking a create action ("Nova venda") with no active
    // unit must not throw an unhandled error — the page must guide the user to
    // create a unit instead.
    test('ação de criar venda sem unidade não crasha', async ({ authedPage }) => {
      await authedPage.goto('/orders')
      // With no active unit /orders renders the "Nenhuma unidade ativa" empty
      // state: the "Nova venda" action is gated out and the surface guides the
      // owner to create a unit. Assert that deterministically (no branching on a
      // maybe-present button) — the empty state IS the non-crash guarantee.
      await expect(authedPage.getByRole('button', { name: 'Nova venda' })).toHaveCount(0)
      await expect(authedPage.getByText('Application error')).toHaveCount(0)
      await expect(authedPage.getByText(/Unhandled Runtime Error/)).toHaveCount(0)
      await expect(authedPage.getByRole('link', { name: /unidade/i }).first()).toBeVisible()
    })
  })

  test.describe('tinha unidade com dados, depois arquivada', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('agenda/orders/dashboard não crasham após arquivar a única unidade', async ({
      org,
      authedPage,
    }) => {
      const unitId = org.unitIds[0]!
      const customerId = seedCustomer(org.orgId, { name: `Cliente NU ${Date.now()}` })
      const start = new Date(Date.now() + 86_400_000).toISOString()
      seedAppointment({
        orgId: org.orgId,
        unitId,
        professionalId: org.professionalIds[0]!,
        customerId,
        serviceId: 'e2e-svc',
        startAt: start,
        endAt: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
        status: 'scheduled',
      })
      seedOpenOrder({ orgId: org.orgId, unitId, customerId, attributedUserId: org.uid })

      // The data now references a unit that gets archived (the reported flow).
      archiveUnit(org.orgId, unitId)

      for (const path of SURFACES) {
        await assertNoCrash(authedPage, path)
      }
    })
  })
})
