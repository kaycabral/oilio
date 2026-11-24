import { expect, test } from '../fixtures'

const AREAS = [
  {
    path: '/catalog?kind=service',
    cta: 'Cadastrar item',
    newPath: '/catalog/new\\?kind=service',
    title: /nenhum item no catálogo/i,
  },
  { path: '/plans', cta: 'Cadastrar plano', newPath: '/plans/new', title: /nenhum plano/i },
  {
    path: '/catalog?kind=product',
    cta: 'Cadastrar item',
    newPath: '/catalog/new\\?kind=product',
    title: /nenhum item no catálogo/i,
  },
] as const

test.describe('Empty-state CTAs — core areas (#987)', () => {
  test.use({
    orgInput: { unitCount: 1, memberOperationCount: 0 },
  })

  for (const area of AREAS) {
    test(`${area.path}: empty state shows a CTA that opens the real create flow`, async ({
      authedPage,
    }) => {
      await authedPage.goto(area.path)

      await expect(authedPage.getByText(area.title)).toBeVisible()
      const cta = authedPage.getByRole('link', { name: area.cta })
      await expect(cta).toBeVisible()

      await cta.click()
      await expect(authedPage).toHaveURL(new RegExp(`${area.newPath}$`))
    })
  }

  test('/customers: empty state CTA opens the contextual-invite dialog', async ({ authedPage }) => {
    await authedPage.goto('/customers')
    await expect(authedPage.getByText(/nenhum cliente/i)).toBeVisible()
    await authedPage.getByRole('button', { name: 'Convidar cliente' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()
    await expect(dialog.locator('input[name="whatsapp"]')).toBeVisible()
  })
})
