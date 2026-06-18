import { expect, test } from '../fixtures'

// Baseline E2E for #986 (brief 0008, Grupo A) — the app is operable from
// signup with NO global onboarding wizard gate. Setup completeness (services,
// professionals, public page) is never required to reach an internal route.
//
// PRD Identidade v2 / brief 0046 reshapes the empty case: a 0-unit owner is
// guided to `/onboarding/first-unit` (the intentional empty-state) — the Negócio
// (folder) exists, the unit does not yet. So "operable without setup" here means
// an org that already has its first unit (the floor the guided flow produces)
// but NO services/professionals reaches every internal route without a gate. The
// 0-unit → guided redirect is asserted as its own invariant below.
//
// AC-01 [critical] [smoke] — every authenticated internal route is reachable
//   for a minimally-set-up org; nothing blocks the app.
// AC-02 [critical] — route access is independent of setup completeness (no
//   global gate).
//
// Scope note: the per-area render+empty / create→list→edit→delete baseline
// lives in each area's own spec (units/services/professionals/... baseline.spec
// + #987 empty-state CTAs). This spec owns the gate-removal invariant.

// `/professionals` was removed (brief 0037 #1085) — people management lives in
// `/team`, which is the people surface this sweep already covers via the nav.
const INTERNAL_ROUTES = [
  '/dashboard',
  '/units',
  '/catalog',
  '/team',
  '/customers',
  '/plans',
] as const

test.describe('Onboarding — app usable without setup (#986)', { tag: '@critical' }, () => {
  test.use({
    // 1ª unidade criada (modo agendamento), nada mais: o piso pós-fluxo-guiado.
    orgInput: { unitCount: 1, professionalCount: 0 },
  })

  test('AC-01/AC-02: minimal org reaches every internal route without an onboarding gate', async ({
    authedPage,
  }) => {
    for (const route of INTERNAL_ROUTES) {
      await authedPage.goto(route)

      // AC-02: no bounce to the onboarding wizard (or any onboarding/login gate).
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/login(\/|$)/)

      // AC-01: the requested route actually rendered…
      await expect(authedPage).toHaveURL(new RegExp(`${route}(/|\\?|$)`))
      // …with the authenticated app shell present (sidebar nav rendered).
      await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
    }
  })

  // With an appointment-mode unit present, the Agenda resolves and is in the
  // nav — no service/professional setup required to reach it (no gate).
  test('com unidade de agendamento: /agenda resolve sem exigir setup', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda(\/|\?|$)/)
    await expect(authedPage.getByRole('link', { name: 'Agenda' })).toBeVisible()
  })

  // Regressão: usuário autenticado abrindo `/` não pode ficar na landing
  // pública (Hero). Era o bug pós-onboarding — `createOrg` faz
  // `redirect('/')` e o `/` não roteava o usuário logado pro app, deixando-o
  // "preso na tela de entrar". O `/` agora manda o autenticado pro app.
  test('usuário autenticado em `/` cai no app, não na landing pública', async ({ authedPage }) => {
    await authedPage.goto('/')
    await expect(authedPage).toHaveURL(/\/dashboard$/)
    await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
  })

  // PRD Identidade v2 / brief 0046 — um dono com ZERO unidade é guiado ao
  // empty-state da 1ª unidade. Mesmo pedindo uma rota interna, o layout (app)
  // bounceia pro fluxo guiado (não é um gate de onboarding wizard — é o
  // empty-state intencional do Negócio recém-criado).
  test.describe('org sem unidade (recém-signup)', () => {
    test.use({ orgInput: { unitCount: 0, professionalCount: 0 } })

    test('dono com 0 unidades é guiado a /onboarding/first-unit', async ({ authedPage }) => {
      await authedPage.goto('/dashboard')
      await expect(authedPage).toHaveURL(/\/onboarding\/first-unit$/)
      await expect(
        authedPage.getByRole('heading', { name: 'Crie sua primeira unidade' }),
      ).toBeVisible()
    })
  })
})
