// Regression: on a tablet-portrait viewport (the PWA's common form factor), a
// hard reload (F5 / app resume) was dropping the sidebar-footer UserMenu — the
// account/Configurações/Sair trigger vanished, leaving no way to reach settings
// or sign out. The footer is NOT conditionally rendered, so the loss is a layout
// regression: the footer gets squeezed out of the clipped `h-dvh` shell when the
// nav content region consumes the column before the footer is laid out.
//
// This drives the real authenticated shell at a tablet viewport, reloads, and
// asserts the account trigger is present AND interactable after the reload — the
// exact user report ("dei F5 no PWA e o UserMenu some").

import { expect, test } from './fixtures'

// iPad-portrait is the canonical PWA tablet form factor and sits at/above the
// `md` (768px) breakpoint — so the desktop sidebar (with its footer UserMenu),
// NOT the mobile header account menu, is what must survive the reload.
test.use({ viewport: { width: 820, height: 1180 } })

test.describe('PWA — UserMenu sobrevive ao reload no tablet', { tag: '@critical' }, () => {
  test('o trigger Conta (UserMenu) continua acessível após F5', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const footer = authedPage.locator('[data-sidebar="footer"]')
    const accountTrigger = footer.getByRole('button', { name: 'Conta' })
    await expect(accountTrigger).toBeVisible()

    // Hard reload — the reported trigger for the disappearance.
    await authedPage.reload()
    await expect(authedPage).toHaveURL(/\/agenda$/)

    // The account menu must still be there AND usable (opens the dropdown).
    await expect(accountTrigger).toBeVisible()
    await accountTrigger.click()
    await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
  })

  // The reported repro is precise: "abro do zero e DEPOIS dou pull-to-refresh, aí
  // o menu some — fica o espaço EM BRANCO" — on an installed tablet PWA. Two facts
  // pin the mechanism: (1) it's the SECOND load, not the first; (2) the footer box
  // stays (its `p-2` space remains) but its CONTENT — the avatar/name/chevron
  // trigger — is gone. That rules out clipping/layout (the space wouldn't remain)
  // and points at bfcache: a standalone-PWA pull-to-refresh can restore the page
  // from the back-forward cache, replaying a frozen DOM where the client-only
  // trigger didn't re-mount. This drives it faithfully: emulate `display-mode:
  // standalone`, then force a real bfcache restore via history navigation (which,
  // unlike reload(), goes through the back-forward cache), and assert the footer
  // still RENDERS its trigger content.
  // The real device is a phone (Redmi), so the width sits near the 768 `md`
  // breakpoint — and the shell gates "mobile" through TWO different sources of
  // truth that disagree there:
  //   • the sidebar uses JS: `useIsMobile()` = `window.innerWidth < 768` → below
  //     it, the sidebar (and its footer UserMenu) becomes an OFF-CANVAS Sheet.
  //   • the header account menu uses CSS: `md:hidden` (`@media min-width:768px`)
  //     → it only shows BELOW 768.
  // On any width where the two disagree by a pixel (device-pixel-ratio rounding,
  // the URL/scroll gutter — routine on a phone WebView), BOTH menus hide at once:
  // the sidebar folded into a closed Sheet AND the header menu hidden by CSS. The
  // footer/header box is present but its content is gone — the reported "espaço em
  // branco". This sweeps the boundary and asserts an account menu is always
  // reachable (footer trigger on desktop widths, header trigger on mobile widths).
  for (const width of [760, 767, 768, 769, 820]) {
    test(`o menu de conta é sempre alcançável na largura ${width}px (limiar md)`, async ({
      authedPage,
    }) => {
      await authedPage.setViewportSize({ width, height: 900 })
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      // At least one account trigger must be VISIBLE — never zero (the blank-space
      // bug). Below md it's the header compact trigger; at/above md it's the
      // sidebar footer. A trigger inside a closed off-canvas Sheet is in the DOM
      // but not visible, so it doesn't count — which is exactly the failure we want
      // to catch. Filter to visible, require ≥1, and open it.
      const visibleTrigger = authedPage
        .getByRole('button', { name: 'Conta' })
        .filter({ visible: true })
      await expect(visibleTrigger).not.toHaveCount(0)
      await visibleTrigger.first().click()
      await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
    })
  }

  // The device-faithful repro. On the real phone (Chrome/WebView Android) the two
  // "is mobile" gates read DIFFERENT numbers at the boundary: `useIsMobile()` uses
  // `window.innerWidth` (JS — subject to a scroll gutter and fractional-DPR
  // rounding), while the header's `md:hidden` uses the CSS `@media (min-width:
  // 768px)` (the layout viewport). Desktop Chromium keeps them equal, so the plain
  // sweep above passes — but a phone routinely has `innerWidth` land a pixel BELOW
  // the CSS breakpoint. That skew is the bug: the sidebar (JS) folds into a closed
  // off-canvas Sheet AS IF mobile, while the header account menu (CSS) stays hidden
  // AS IF desktop — both gone, leaving the blank space the user saw. We force the
  // skew by pinning `window.innerWidth` one pixel below 768 while the CSS layout
  // stays at exactly 768 (media query = desktop), and assert a menu still shows.
  test('menu de conta sobrevive à divergência innerWidth-vs-CSS no limiar (repro do device)', async ({
    authedPage,
  }) => {
    // Reproduce the phone's boundary skew: the CSS layout viewport sits AT 768
    // (so a CSS `md:` query would read DESKTOP), but `window.innerWidth` — what
    // `useIsMobile` reads — is one pixel BELOW it (the scroll-gutter / fractional-
    // DPR rounding a real WebView shows). Before the fix, the sidebar folded away
    // as mobile (innerWidth) while a CSS-gated header menu stayed hidden as desktop
    // → both account menus gone (blank footer). We forge ONLY `innerWidth` (leaving
    // `matchMedia` untouched, so nothing else in the app breaks); the fix routes
    // the header menu through the SAME `isMobile`, so an account trigger is present.
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
