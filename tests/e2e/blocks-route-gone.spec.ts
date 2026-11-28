import { expect, test } from './fixtures'
import { expectNotFound } from './helpers/not-found'

test.describe('`/blocks` removida (#1083 AC-01/AC-05)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  const GONE_ROUTES = ['/blocks', '/blocks/new'] as const

  for (const route of GONE_ROUTES) {
    test(`${route} não existe (404)`, async ({ authedPage }) => {
      await expectNotFound(authedPage, route)
    })
  }

  test('a rota de edição por id também sumiu (404)', async ({ authedPage }) => {
    await expectNotFound(authedPage, '/blocks/qualquer-id')
  })

  test('a nav não oferece mais "Bloqueios"', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage.getByRole('link', { name: 'Bloqueios' })).toHaveCount(0)
  })
})
