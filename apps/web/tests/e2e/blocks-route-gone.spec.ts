// Regression E2E for #1083 (brief 0036 AC-01/AC-05): the `/blocks` route is
// removed entirely — list, `new`, and `[id]`. Blocking lives in the responsible
// context now (unit config + member detail). Navigating to `/blocks` must 404,
// and the nav no longer offers "Bloqueios".

import { expect, test } from './fixtures'

test.describe('`/blocks` removida (#1083 AC-01/AC-05)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  const GONE_ROUTES = ['/blocks', '/blocks/new'] as const

  for (const route of GONE_ROUTES) {
    test(`${route} não existe (404)`, async ({ authedPage }) => {
      const res = await authedPage.goto(route)
      expect(res?.status()).toBe(404)
      await expect(authedPage.getByText(/404|não encontrad|not found/i).first()).toBeVisible()
    })
  }

  test('a rota de edição por id também sumiu (404)', async ({ authedPage }) => {
    const res = await authedPage.goto('/blocks/qualquer-id')
    expect(res?.status()).toBe(404)
  })

  test('a nav não oferece mais "Bloqueios"', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage.getByRole('link', { name: 'Bloqueios' })).toHaveCount(0)
  })
})
