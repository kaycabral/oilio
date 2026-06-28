import { expect, test } from '../fixtures'

// Baseline E2E for #986 (brief 0008, Grupo A) — the app is operable from
// signup with NO global onboarding wizard gate. Setup completeness (services,
// memberOperations, public page) is never required to reach an internal route.
//
// PRD Identidade v2 / brief 0046 reshapes the empty case: there is NO first-unit
// gate — a 0-unit owner lands in the app normally (empty-states where data is
// unit-scoped), never a forced onboarding screen. "Operable without setup" means
// an org with NO services/memberOperations reaches every internal route without a
// gate; the unit-scoped surfaces simply render their empty-state.
//
// AC-01 [critical] [smoke] — every authenticated internal route is reachable
//   for a minimally-set-up org; nothing blocks the app.
// AC-02 [critical] — route access is independent of setup completeness (no
//   global gate).
//
// Scope note: the per-area render+empty / create→list→edit→delete baseline
// lives in each area's own spec (units/services/memberOperations/... baseline.spec
// + #987 empty-state CTAs). This spec owns the gate-removal invariant.

// `/memberOperations` was removed (brief 0037 #1085) — people management lives in
// `/team`, which is the people surface this sweep already covers via the nav.
const INTERNAL_ROUTES = [
  '/dashboard',
  '/organizations',
  '/catalog',
  '/team',
  '/customers',
  '/plans',
] as const

test.describe('Onboarding — app usable without setup (#986)', { tag: '@critical' }, () => {
  test.use({
    // 1ª unidade criada (modo agendamento), nada mais: o piso pós-fluxo-guiado.
    orgInput: { unitCount: 1, memberOperationCount: 0 },
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
  // nav — no service/memberOperation setup required to reach it (no gate).
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

  // PRD Identidade v2 / brief 0046 — um dono com ZERO unidade NÃO é gateado: cai
  // no app normalmente e as superfícies unit-scoped renderizam seu empty-state.
  test.describe('org sem unidade (recém-signup)', () => {
    test.use({ orgInput: { unitCount: 0, memberOperationCount: 0 } })

    test('dono com 0 unidades cai no app sem gate de onboarding', async ({ authedPage }) => {
      await authedPage.goto('/dashboard')
      await expect(authedPage).toHaveURL(/\/dashboard(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
    })
  })
})
