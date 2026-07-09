import { expect, test } from './fixtures'

test.use({ viewport: { width: 820, height: 1180 } })

test.describe('PWA — UserMenu sobrevive ao reload no tablet', { tag: '@critical' }, () => {
  test('o trigger Conta (UserMenu) continua acessível após F5', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const footer = authedPage.locator('[data-sidebar="footer"]')
    const accountTrigger = footer.getByRole('button', { name: 'Conta' })
    await expect(accountTrigger).toBeVisible()

    await authedPage.reload()
    await expect(authedPage).toHaveURL(/\/agenda$/)

    await expect(accountTrigger).toBeVisible()
    await accountTrigger.click()
    await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
  })

  for (const width of [760, 767, 768, 769, 820]) {
    test(`o menu de conta é sempre alcançável na largura ${width}px (limiar md)`, async ({
      authedPage,
    }) => {
      await authedPage.setViewportSize({ width, height: 900 })
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const visibleTrigger = authedPage
        .getByRole('button', { name: 'Conta' })
        .filter({ visible: true })
      await expect(visibleTrigger).not.toHaveCount(0)
      await visibleTrigger.first().click()
      await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
    })
  }

  test('menu de conta sobrevive à divergência innerWidth-vs-CSS no limiar (repro do device)', async ({
    authedPage,
  }) => {
    await authedPage.setViewportSize({ width: 768, height: 900 })
    await authedPage.addInitScript(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => 767 })
    })
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const visibleTrigger = authedPage
      .getByRole('button', { name: 'Conta' })
      .filter({ visible: true })
    await expect(visibleTrigger).not.toHaveCount(0)
    await visibleTrigger.first().click()
    await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
  })
})
