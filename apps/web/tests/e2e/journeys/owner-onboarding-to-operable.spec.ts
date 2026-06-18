// Journey E2E for #1076 (brief 0035 AC-05) — onboarding just-in-time → operável.
// A freshly-onboarded owner (completed profile, no units yet) is guided to create
// the first unit (PRD Identidade v2 / brief 0046): a 0-unit owner auto-redirects
// to the guided empty-state `/onboarding/first-unit` (not the `/units` list empty
// state — that's unreachable for a 0-unit owner now). This journey asserts the
// just-in-time chain: lands operable → guided first-unit → real creation flow.

import { expect, test } from '../fixtures'
import { seedOrg, signInAndAttachSession } from '../helpers/session'

test.describe(
  'Owner — onboarding just-in-time → operável (#1076 · 0035)',
  { tag: '@critical' },
  () => {
    test('org recém-criado guia à 1ª unidade pelo create real (AC-05 · 0046)', async ({
      context,
      page,
      baseURL,
    }) => {
      // Owner completo, org sem nenhuma unidade — o estado logo após o signup.
      const seed = await seedOrg({ unitCount: 0, professionalCount: 0 })
      await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

      // Operável desde já, sem gate global de setup: um dono com 0 unidades é
      // levado AUTOMATICAMENTE ao empty-state guiado da 1ª unidade (brief 0046).
      // Mesmo pedindo `/units`, o layout (app) bounceia pro fluxo guiado.
      await page.goto('/units')
      await expect(page).toHaveURL(/\/onboarding\/first-unit$/)
      await expect(page.getByRole('heading', { name: 'Crie sua primeira unidade' })).toBeVisible()

      // O empty-state guiado JÁ É o fluxo REAL de criação (UnitForm prefilled),
      // não um wizard separado: o nome vem prefilled = nome do Negócio (não-vazio).
      await expect(page.locator('input[name="name"]')).toHaveValue(/.+/)
      await expect(page.getByRole('button', { name: 'Criar' })).toBeVisible()
    })
  },
)
