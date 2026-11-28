import { expect, test } from '../fixtures'

test.describe('Páginas legais (#58)', () => {
  test('o cadastro linka os Termos e a Política de Privacidade', async ({ page }) => {
    await page.goto('/signup')
    await page.getByRole('link', { name: 'Termos', exact: true }).click()
    await expect(page).toHaveURL(/\/terms$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeVisible()

    await page.goto('/signup')
    await page.getByRole('link', { name: 'Política de Privacidade' }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Política de Privacidade' }),
    ).toBeVisible()
  })

  test('o rodapé público linka as duas páginas', async ({ page }) => {
    await page.goto('/pricing')
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByRole('link', { name: 'Termos' })).toHaveAttribute('href', '/terms')
    await expect(footer.getByRole('link', { name: 'Privacidade' })).toHaveAttribute(
      'href',
      '/privacy',
    )
  })
})
