import { expect, test } from '../fixtures'

// Baseline E2E for #986 (brief 0008, Grupo A) — the app is operable from
// signup with NO global onboarding gate. A brand-new org with no units,
// professionals or services must reach every internal route (nothing bounces
// it away — the onboarding wizard is gone since #1028).
//
// AC-01 [critical] [smoke] — every authenticated internal route is reachable
//   for an empty org; nothing blocks the app.
// AC-02 [critical] — route access is independent of setup completeness (no
//   global gate).
//
// Scope note: the per-area render+empty / create→list→edit→delete baseline
// lives in each area's own spec (units/services/professionals/... baseline.spec
// + #987 empty-state CTAs). This spec owns the gate-removal invariant.

// `/professionals` was removed (brief 0037 #1085) — people management lives in
// `/team`, which is the people surface this sweep already covers via the nav.
// `/agenda` is intentionally NOT here: the app is multi-vertical, and the
// Agenda is hidden/redirected when no unit uses the appointment hours mode.
// An empty org (no units) has no appointment-mode unit, so visiting
// `/agenda` redirects to `/orders` and the nav hides the Agenda item. The
// agenda-hidden invariant is asserted separately below.
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
    orgInput: { unitCount: 0, professionalCount: 0 },
  })

  test('AC-01/AC-02: empty org reaches every internal route without an onboarding gate', async ({
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
      // Agenda is hidden for this no-appointment-unit org, so we anchor the
      // shell on a vertical-agnostic nav item that's always present.
      await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()

      // The app is multi-vertical: with no appointment-mode unit, the Agenda
      // nav item is absent on every shell.
      await expect(authedPage.getByRole('link', { name: 'Agenda' })).toHaveCount(0)
    }
  })

  // The Agenda is hidden/redirected for a org with no appointment-mode unit:
  // visiting `/agenda` directly bounces to `/orders` (it is not an onboarding
  // gate — every other route still resolves, asserted above).
  test('sem unidade de agendamento: /agenda redireciona pra /orders e some do nav', async ({
    authedPage,
  }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
    await expect(authedPage.getByRole('link', { name: 'Agenda' })).toHaveCount(0)
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
})
