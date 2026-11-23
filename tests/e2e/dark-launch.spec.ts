import { expect, test } from './fixtures'

const FLAGS_OFF = process.env.E2E_FLAGS_OFF === '1'

const GATED_ROUTES = ['/finance', '/copilot', '/notifications', '/settings/notifications'] as const

const GATED_API = ['/api/notifications?unitId=x&limit=10'] as const

if (FLAGS_OFF) {
  test.describe('Dark-launch: Finance/Copilot/Notifications hidden when flags off', () => {
    test.use({ orgInput: { unitCount: 1 } })

    for (const route of GATED_ROUTES) {
      test(`${route} responde 404 com as flags off`, async ({ authedPage }) => {
        const res = await authedPage.goto(route)
        expect(res?.status(), `${route} deve ser 404 em dark-launch`).toBe(404)
        await expect(authedPage.getByText(/404|não encontrad|not found/i).first()).toBeVisible()
      })
    }

    for (const api of GATED_API) {
      test(`${api} responde 404 com as flags off`, async ({ authedPage }) => {
        const res = await authedPage.request.get(api)
        expect(res.status(), `${api} deve ser 404 em dark-launch`).toBe(404)
      })
    }

    test('a nav não oferece Financeiro nem Copiloto', async ({ authedPage }) => {
      await authedPage.goto('/orders?status=open')
      await expect(authedPage.getByRole('link', { name: 'Financeiro' })).toHaveCount(0)
      await expect(authedPage.getByRole('link', { name: 'Copiloto' })).toHaveCount(0)
    })

    test('o sino de notificações não é renderizado no header', async ({ authedPage }) => {
      await authedPage.goto('/orders?status=open')
      await expect(authedPage.getByRole('button', { name: 'Notificações' })).toHaveCount(0)
    })
  })
}
