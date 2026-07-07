// Regression (#1379): on the installed PWA (Android/Chromium standalone, device
// Xiaomi/HyperOS), the sidebar-footer UserMenu disappears — proven ON THE REAL
// DEVICE via chrome://inspect to be a LAYOUT bug, not bfcache / useIsMobile:
//
//   viewport visível (innerHeight / visualViewport / 100dvh) = 664px
//   sidebar-wrapper (h-dvh) computou                          = 720px  ← 56px a mais
//   botão Conta: top=664 (= fundo da viewport) → todo ABAIXO do fold, cortado
//     pelo `overflow-hidden` do wrapper.
//
// The WebView's DYNAMIC viewport (`dvh`) resolves LARGER than the actually-visible
// height when the system bar geometry shifts (refresh/resume): the shell's
// `h-dvh` containers (`sidebar-wrapper` + the `fixed inset-y-0` `sidebar-container`)
// become taller than the screen, and the footer — the last flex child — is pushed
// past the fold.
//
// Desktop Chromium keeps `100dvh === innerHeight`, so this NEVER reproduces on a
// plain viewport. Here we FORGE the device divergence: an injected stylesheet
// makes the `h-dvh` utility resolve to the device's measured 720px while the real
// viewport stays 664px. We target the `h-dvh` UTILITY (via an attribute hook the
// injected CSS matches on the classes actually present), so a fix that stops using
// `h-dvh` on the container is genuinely exercised. No product code is touched.

import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'

// Real device metrics captured over chrome://inspect: 1138×664 @ dpr 2.25.
const DEVICE = { width: 1138, height: 664 }
// `100dvh` computed on the device while the visible viewport was 664.
const DVH_PX = 720

test.use({ viewport: DEVICE, deviceScaleFactor: 2.25 })

// Forge the WebView divergence: override the Tailwind `h-dvh` utility so anything
// styled with it resolves to the device value, NOT the real 664 viewport. Because
// we hook the class `.h-dvh` itself, an element that DROPS `h-dvh` (the fix) is no
// longer stretched and falls back to its own sizing (`inset-y-0`). The rule is
// built with `insertRule` (structured API, no string-to-HTML) so no product code
// and no unsafe DOM sink is involved.
function forgeDvh(px: number) {
  const apply = () => {
    const style = document.createElement('style')
    style.id = '__forge_dvh'
    document.head.appendChild(style)
    style.sheet?.insertRule(`.h-dvh { height: ${px}px !important; }`)
  }
  if (document.head) apply()
  else document.addEventListener('DOMContentLoaded', apply)
}

async function contaGeometry(page: Page) {
  return page.getByRole('button', { name: 'Conta' }).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), innerHeight: window.innerHeight }
  })
}

test.describe('PWA — UserMenu não pode cair abaixo do fold do h-dvh', { tag: '@critical' }, () => {
  test('o footer/Conta permanece dentro da viewport visível (não abaixo do fold)', async ({
    authedPage,
  }) => {
    await authedPage.addInitScript(forgeDvh, DVH_PX)
    await authedPage.goto('/dashboard')
    await expect(authedPage).toHaveURL(/\/dashboard$/)

    const conta = authedPage.getByRole('button', { name: 'Conta' })
    await expect(conta).toHaveCount(1)

    // The REAL assertion — geometry vs the visible viewport (what the device probe
    // measured). The DOM may report the element "visible" (in the layout, opacity 1)
    // while it sits below the fold, clipped off-screen. A user-invisible trigger is
    // a fail even though `toBeVisible()` might pass.
    const geo = await contaGeometry(authedPage)
    expect(
      geo.bottom,
      `account trigger bottom (${geo.bottom}) must be within the visible viewport (${geo.innerHeight}) — não pode ficar abaixo do fold do h-dvh`,
    ).toBeLessThanOrEqual(geo.innerHeight)

    await conta.click()
    await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
  })
})
