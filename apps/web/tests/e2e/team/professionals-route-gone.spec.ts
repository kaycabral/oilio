import { expect, test } from '../fixtures'

test.describe('`/memberOperations` removida (#1085 AC-01)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  const GONE_ROUTES = ['/memberOperations', '/memberOperations/new'] as const

  for (const route of GONE_ROUTES) {
    test(`${route} não existe (404)`, async ({ authedPage }) => {
      const res = await authedPage.goto(route)
      expect(res?.status()).toBe(404)
      await expect(authedPage.getByText(/404|não encontrad|not found/i).first()).toBeVisible()
    })
  }

  test('a rota de edição por id também sumiu (404)', async ({ org, authedPage }) => {
    const res = await authedPage.goto(`/memberOperations/${org.memberOperationIds[0]!}`)
    expect(res?.status()).toBe(404)
  })

  test('a nav não oferece mais "Profissionais"', async ({ authedPage }) => {
    await authedPage.goto('/team')
    await expect(authedPage.getByRole('link', { name: 'Profissionais' })).toHaveCount(0)
    await expect(authedPage.getByRole('link', { name: 'Equipe' }).first()).toBeVisible()
  })
})
