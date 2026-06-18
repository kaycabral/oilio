// Regression E2E for #1085 (brief 0037 AC-01): the `/professionals` route is
// removed entirely — list, `new`, and `[id]`. Navigating there must 404 (Next
// renders the not-found page for an unmatched route). People management lives
// only in `/team` now, and the nav no longer offers "Profissionais".

import { expect, test } from '../fixtures'

test.describe('`/professionals` removida (#1085 AC-01)', () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  const GONE_ROUTES = ['/professionals', '/professionals/new'] as const

  for (const route of GONE_ROUTES) {
    test(`${route} não existe (404)`, async ({ authedPage }) => {
      const res = await authedPage.goto(route)
      // Unmatched App Router route → 404 status + the not-found body.
      expect(res?.status()).toBe(404)
      await expect(authedPage.getByText(/404|não encontrad|not found/i).first()).toBeVisible()
    })
  }

  test('a rota de edição por id também sumiu (404)', async ({ org, authedPage }) => {
    const res = await authedPage.goto(`/professionals/${org.professionalIds[0]!}`)
    expect(res?.status()).toBe(404)
  })

  test('a nav não oferece mais "Profissionais"', async ({ authedPage }) => {
    await authedPage.goto('/team')
    await expect(authedPage.getByRole('link', { name: 'Profissionais' })).toHaveCount(0)
    // …mas "Equipe" continua (a superfície única).
    await expect(authedPage.getByRole('link', { name: 'Equipe' }).first()).toBeVisible()
  })
})
