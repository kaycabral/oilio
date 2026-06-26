// Feature E2E — definition forms default to the active unit (brief 0039,
// AC-03 / DoD Cenário 2, sub-issue #1092).
//
// The multi-unit DEFINITION select stays (a catalog item / professional can
// exist in multiple units — brief 0012). The only change is the DEFAULT:
//   - a NEW catalog item pre-checks the active unit, and the user can still
//     check other units (multi-select preserved);
//   - editing an EXISTING professional's units shows its CURRENT units intact —
//     the default never resets a stored selection to just the active unit.
//
// Runs against the emulator (no mocks). The active unit is driven via the
// `activeUnitId` cookie (same approach as the #1050 journey spec — the switcher
// UI that writes the cookie is out of scope here).

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '../fixtures'
import { ProfessionalsPage } from '../pages'

const ACTIVE_UNIT_COOKIE = 'activeUnitId'

async function setActiveUnitCookie(
  context: BrowserContext,
  baseURL: string | undefined,
  unitId: string,
): Promise<void> {
  const url = new URL(baseURL ?? 'http://localhost:3005')
  await context.addCookies([
    {
      name: ACTIVE_UNIT_COOKIE,
      value: unitId,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test.describe('Definição default na unidade ativa (#1092)', () => {
  test.describe('org multi-unidade', () => {
    // Two units: "Unidade 1" (unitIds[0]) and "Unidade 2" (unitIds[1]).
    test.use({ orgInput: { unitCount: 2, professionalCount: 1 } })

    test('novo item de catálogo pré-marca a unidade ativa, multi-select preservado', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitOne, unitTwo] = org.unitIds
      expect(unitOne).toBeTruthy()
      expect(unitTwo).toBeTruthy()

      // Make "Unidade 2" the active unit (not the default first-by-name).
      await setActiveUnitCookie(context, baseURL, unitTwo!)

      await authedPage.goto('/catalog/new')
      await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()

      const offered = authedPage.getByRole('group', { name: 'Onde é oferecido', exact: true })
      // The design Checkbox is a button (role=checkbox); the `input[name]` is its
      // hidden form mirror, so drive the visible checkbox via its enclosing label.
      const unitBox = (id: string) =>
        offered
          .locator('label')
          .filter({ has: authedPage.locator(`input[name="unitIds"][value="${id}"]`) })
          .getByRole('checkbox')
      const unitOneBox = unitBox(unitOne!)
      const unitTwoBox = unitBox(unitTwo!)

      // The active unit (Unidade 2) is pre-checked by default; the other is not.
      await expect(unitTwoBox).toBeChecked()
      await expect(unitOneBox).not.toBeChecked()

      // Multi-select preserved: the user can still check the other unit.
      await unitOneBox.check()
      await expect(unitOneBox).toBeChecked()
      await expect(unitTwoBox).toBeChecked()
    })

    test('editar unidades de um profissional preserva a seleção atual (não reseta pra ativa)', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitOne, unitTwo] = org.unitIds
      // The seeded professional is linked to ALL units (both).
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`

      // Active unit = "Unidade 2"; the pro already has BOTH units stored.
      await setActiveUnitCookie(context, baseURL, unitTwo!)

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(proUid)

      const unitsGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      const unitOneBox = unitsGroup.locator(`input[name="unitIds"][value="${unitOne}"]`)
      const unitTwoBox = unitsGroup.locator(`input[name="unitIds"][value="${unitTwo}"]`)

      // Both stay checked — the active-unit default must NOT collapse the
      // existing multi-unit selection down to just the active unit.
      await expect(unitOneBox).toBeChecked()
      await expect(unitTwoBox).toBeChecked()
    })
  })
})
