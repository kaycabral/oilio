import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'

const DEVICE = { width: 1138, height: 664 }
const DVH_PX = 720

test.use({ viewport: DEVICE, deviceScaleFactor: 2.25 })

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

    const geo = await contaGeometry(authedPage)
    expect(
      geo.bottom,
      `account trigger bottom (${geo.bottom}) must be within the visible viewport (${geo.innerHeight}) — não pode ficar abaixo do fold do h-dvh`,
    ).toBeLessThanOrEqual(geo.innerHeight)

    await conta.click()
    await expect(authedPage.getByRole('menuitem', { name: /Configurações/ })).toBeVisible()
  })
})
