import { expect, test } from './fixtures'

test.describe('Home', () => {
  test('renderiza o hero', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Oilio' })).toBeVisible()
    await expect(page.getByRole('link', { name: /entrar/i })).toBeVisible()
  })
})
