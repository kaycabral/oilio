import { expect, test } from '@playwright/test'

// Brief 0095 — the login screen is a split: entry column on the left, decorative
// panel on the right from `md` (768px) up. The direction of that breakpoint is
// the whole point of these specs. Reading it as "hide the panel on mobile"
// yields `md:hidden`, which blanks the panel at exactly the width the reference
// still shows it — and every unit test would stay green, because jsdom cannot
// evaluate a media query. Only a real viewport catches it.

const MONTAGE_MARKER = 'Assinantes ativos'

test.describe('Login — split-screen responsivo (0095)', { tag: '@critical' }, () => {
  test('mobile (390px): coluna única, sem painel decorativo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: /entre na sua conta/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()

    // The panel is out of the layout below md.
    await expect(page.getByText(MONTAGE_MARKER)).toBeHidden()

    // Short subtitle here; the full pitch belongs to the wide layout.
    await expect(page.getByText(/sua agenda, assinaturas e caixa num lugar só/i)).toBeVisible()
    await expect(page.getByText(/entre para continuar de onde parou/i)).toBeHidden()
  })

  test('tablet (768px): split ATIVO — o painel aparece nesta largura', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/login')

    await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
    // 768px is where the split turns ON. This assertion is the guard against the
    // inverted breakpoint.
    await expect(page.getByText(MONTAGE_MARKER)).toBeVisible()
    await expect(page.getByText(/entre para continuar de onde parou/i)).toBeVisible()
  })

  // Sweep the seam the way pwa-usermenu-tablet.spec.ts does for the sidebar:
  // one pixel below md the panel must be gone, at md and above it must show.
  for (const width of [320, 767]) {
    test(`limiar md — painel oculto em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/login')

      await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
      await expect(page.getByText(MONTAGE_MARKER)).toBeHidden()
    })
  }

  for (const width of [768, 1024, 1280]) {
    test(`limiar md — painel visível em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/login')

      await expect(page.getByRole('button', { name: /continuar com google/i })).toBeVisible()
      await expect(page.getByText(MONTAGE_MARKER)).toBeVisible()
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
