import { expect, test } from '../fixtures'
import { expectNotFound } from '../helpers/not-found'

test.describe('`/memberOperations` removida (#1085 AC-01)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  const GONE_ROUTES = ['/memberOperations', '/memberOperations/new'] as const

  for (const route of GONE_ROUTES) {
    test(`${route} não existe (404)`, async ({ authedPage }) => {
      await expectNotFound(authedPage, route)
    })
  }

  test('a rota de edição por id também sumiu (404)', async ({ org, authedPage }) => {
    await expectNotFound(authedPage, `/memberOperations/${org.memberOperationIds[0]!}`)
  })

  test('a nav não oferece mais "Profissionais"', async ({ authedPage }) => {
    await authedPage.goto('/team')
    await expect(authedPage.getByRole('link', { name: 'Profissionais' })).toHaveCount(0)
    await expect(authedPage.getByRole('link', { name: 'Equipe' }).first()).toBeVisible()
  })
})
