import { expect, test } from '@playwright/test'

const MONTAGE_MARKER = 'Assinantes ativos'

test.describe('Login — split-screen responsivo (0095)', { tag: '@critical' }, () => {
  test('mobile (390px): coluna única, sem painel decorativo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: /entre na sua conta/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
    await expect(page.getByText(MONTAGE_MARKER).first()).toBeHidden()
    await expect(page.getByText(/sua agenda, assinaturas e caixa num lugar só/i)).toBeVisible()
    await expect(page.getByText(/entre para continuar de onde parou/i)).toBeHidden()
  })

  test('tablet (768px): split ATIVO — 768px liga o split, não desliga', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/login')

    await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
    await expect(page.getByText(MONTAGE_MARKER).first()).toBeVisible()
    await expect(page.getByText(/entre para continuar de onde parou/i)).toBeVisible()
  })

  for (const width of [320, 767]) {
    test(`limiar md — painel oculto em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/login')

      await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
      await expect(page.getByText(MONTAGE_MARKER).first()).toBeHidden()
    })
  }

  for (const width of [768, 1024, 1280]) {
    test(`limiar md — painel visível em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/login')

      await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
      await expect(page.getByText(MONTAGE_MARKER).first()).toBeVisible()
    })
  }

  test('sem overflow horizontal em telas estreitas', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/login')

    await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflows, 'a página não pode rolar horizontalmente a 320px').toBe(false)
  })

  test('o botão OAuth tem alvo de toque confortável', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')

    const button = page.getByRole('button', { name: /continuar com google/i })
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  test('a coluna de entrada é o landmark main', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/login')

    await expect(page.getByRole('main')).toContainText('Entre na sua conta')
  })
})
