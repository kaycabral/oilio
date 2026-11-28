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

  test('as páginas legais identificam o controlador e o e-mail de contato', async ({ page }) => {
    for (const path of ['/privacy', '/terms']) {
      await page.goto(path)
      await expect(page.getByRole('link', { name: 'contato@cbrl.dev' }).first()).toHaveAttribute(
        'href',
        'mailto:contato@cbrl.dev',
      )
      await expect(page.getByText(/CABRAL TECNOLOGIA LTDA.*40\.148\.980\/0001-99/)).toBeVisible()
      await expect(page.getByText('A DEFINIR')).toHaveCount(0)
    }
  })
})
