import { expect, test } from '../fixtures'

test.describe('Dashboard — gate de autenticação', () => {
  test('usuário não autenticado é redirecionado pra /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})
