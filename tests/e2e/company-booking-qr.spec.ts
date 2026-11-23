import { expect, test } from './fixtures'
import { setActiveUnitCookie } from './helpers/session'
import { orgSlug } from './pages'

test.describe('Unidade — QR por unidade', () => {
  test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

  test('QR por unidade aponta pra /{slug}/{unitSlug} na página da unidade', async ({
    context,
    org,
    authedPage,
    baseURL,
  }) => {
    const slug = orgSlug(org.orgId)

    await setActiveUnitCookie(context, org.unitIds[0]!, baseURL ?? undefined)

    for (const [i, unitId] of org.unitIds.entries()) {
      const unitSlug = `unidade-${i + 1}`
      await authedPage.goto(`/units/${unitId}`)

      await expect(authedPage.getByText('QR pra agendamento')).toBeVisible()
      await expect(authedPage.getByText(new RegExp(`/signup\\?.*from=${slug}`))).toBeVisible()
      await expect(authedPage.getByText(`/${unitSlug}`, { exact: true })).toBeVisible()
    }
  })
})
