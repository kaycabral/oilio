import type { BrowserContext } from '@playwright/test'
import { expect, test } from '../fixtures'
import { MemberOperationsPage } from '../pages'

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
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('novo item de catálogo pré-marca a unidade ativa, multi-select preservado', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitOne, unitTwo] = org.unitIds
      expect(unitOne).toBeTruthy()
      expect(unitTwo).toBeTruthy()

      await setActiveUnitCookie(context, baseURL, unitTwo!)

      await authedPage.goto('/catalog/new')
      await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()

      const offered = authedPage.getByRole('group', { name: 'Onde é oferecido', exact: true })
      const unitBox = (id: string) =>
        offered
          .locator('label')
          .filter({ has: authedPage.locator(`input[name="unitIds"][value="${id}"]`) })
          .getByRole('checkbox')
      const unitOneBox = unitBox(unitOne!)
      const unitTwoBox = unitBox(unitTwo!)

      await expect(unitTwoBox).toBeChecked()
      await expect(unitOneBox).not.toBeChecked()

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
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`

      await setActiveUnitCookie(context, baseURL, unitTwo!)

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)

      const unitsGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      const unitOneBox = unitsGroup.locator(`input[name="unitIds"][value="${unitOne}"]`)
      const unitTwoBox = unitsGroup.locator(`input[name="unitIds"][value="${unitTwo}"]`)

      await expect(unitOneBox).toBeChecked()
      await expect(unitTwoBox).toBeChecked()
    })
  })
})
