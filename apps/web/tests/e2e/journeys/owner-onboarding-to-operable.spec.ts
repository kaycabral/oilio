// Journey E2E for #1076 (brief 0035 AC-05) — onboarding just-in-time → operável.
// A freshly-onboarded owner (completed profile, no units yet) is operable from
// the start (no global setup gate, brief 0008) and the empty-state CTAs lead to
// the REAL create flow. The per-surface create→list→edit→delete round-trip is
// owned by each surface's baseline.spec (referenced in the coverage matrix);
// this journey asserts the just-in-time chain: lands operable → empty-state CTA
// opens the real creation flow.

import { expect, test } from '../fixtures'
import { seedTenant, signInAndAttachSession } from '../helpers/session'

test.describe(
  'Owner — onboarding just-in-time → operável (#1076 · 0035)',
  { tag: '@critical' },
  () => {
    test('tenant recém-criado é operável; o empty-state CTA abre o create real (AC-05)', async ({
      context,
      page,
      baseURL,
    }) => {
      // Owner completo, tenant sem nenhuma unidade — o estado logo após o signup.
      const seed = await seedTenant({ unitCount: 0, professionalCount: 0 })
      await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

      // Operável desde já: nenhum gate global trava o app sem setup (brief 0008).
      // A unidade vazia mostra o protagonista (brief 0034) com 1 CTA.
      await page.goto('/units')
      await expect(page.getByText('Nenhuma unidade cadastrada')).toBeVisible()

      // O CTA do empty-state abre o fluxo REAL de criação (just-in-time).
      await page.getByRole('link', { name: 'Cadastrar unidade' }).click()
      await expect(page).toHaveURL(/\/units\/new$/)
      await expect(page.getByRole('heading', { name: 'Nova unidade' })).toBeVisible()
    })
  },
)
