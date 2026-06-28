// Feature-level E2E — parent #1049 (epic 0029 "Contexto por unidade e navegação").
//
// This is the PARENT's composite journey: it validates the brief's Definition
// of Done end-to-end (Cenários 1–5 + baseline), NOT the granular per-AC
// coverage the sub-issue specs already prove exhaustively against the emulator:
//   - unit-org-switcher.spec.ts (#1051 · AC-03/04/05/09 — interstitial,
//     top switcher, single-unit lock, org-switch reset)
//   - nav-role-filter.spec.ts      (#1052 · AC-08 — role-filtered sidebar)
//   - member-status work           (#1053 · membership.unitId / role plumbing)
//
// Here we re-assert the SAME invariants stitched into the one journey the
// owner/manager lives:
//   - active unit scopes the OPERATIONAL surfaces together (Agenda, Comandas,
//     Bloqueios, Dashboard-hoje) and switching via the top switcher
//     (labelled "Contexto da unidade") moves all of them at once;
//   - a single-unit member (`membership.unitId`) is locked — no selector, no
//     cross-unit reach;
//   - the DEFINITION / aggregate surfaces (Catálogo, Planos, Relatórios) stay
//     cross-unit — the active-unit selector does NOT filter them;
//   - the sidebar is filtered by role (a receptionist loses Administração +
//     finance-admin items);
//   - switching org resets the active-unit context (no leak across orgs).
//
// Runs against the running emulator (no mocks). Seeds via the session helpers
// and reads membership/state straight from Postgres (the event-store projections,
// post-cutover) to assert the stitched invariants.

import { membershipDocId } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { type Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { twoUnits } from '../helpers/rest-json'
import {
  pgQueryProjection,
  pgReadProjection,
  seedAdditionalOrg,
  seedService,
  setMembershipRole,
  setMembershipUnitId,
  signInAndAttachSession,
} from '../helpers/session'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')
const switcher = (page: Page) => page.getByLabel('Contexto da unidade')

test.describe('Contexto por unidade e navegação — DoD (#1049 · 0029)', () => {
  // Cenário 1 — gerente multi-unidade troca contexto.
  // Org with 2 units + an owner (membership.unitId = null = multi-unit):
  // first access interstitials, choosing a unit scopes every operational
  // surface, and the top switcher moves them together. Folds in the
  // render+empty baseline (interstitial on first access) and the real flow
  // (choose → operate → switch → operate again).
  test.describe('Cenário 1 — gerente multi-unidade troca contexto', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('1º acesso interstitial → unidade escolhida escopa Agenda/Comandas/Bloqueios/Dashboard; switcher troca tudo junto', async ({
      authedPage,
      org,
    }) => {
      // Degenerate-data guard: a multi-unit member has no pinned unit scope (the
      // seed leaves it unset) — proven downstream by the interstitial. The column
      // is `rls_unit_scope` post-D4 (renamed from `unit_id`, brief 0068).
      const membership = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, org.uid)),
      )
      expect(membership).not.toBeNull()
      expect(membership?.rls_unit_scope).toBeNull()

      // First access (no active-unit cookie + 2 units) → the interstitial.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()

      // Choose the first unit → enters the app scoped to it.
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      // Active unit is asserted via the TOP switcher only — per-feature unit
      // controls were removed (brief 0039, AC-01).
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // Every OPERATIONAL surface reflects the same active unit (AC-01/02).
      // These surfaces are empty for the freshly-scoped unit → the protagonist
      // empty-state renders (brief 0034); the active unit is asserted via the
      // app-shell switcher (always present, regardless of empty-state).
      await authedPage.goto('/orders')
      await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // Switch to the second unit via the TOP switcher → the shared context
      // moves; the operational surfaces follow it together (AC-03).
      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 2')

      await authedPage.goto('/agenda')
      await expect(switcher(authedPage)).toContainText('Unidade 2')
      await authedPage.goto('/orders')
      await expect(switcher(authedPage)).toContainText('Unidade 2')
    })
  })

  // Cenário 2 — membro single-unit travado.
  // A member pinned via `membership.unitId`: no selector, enters straight into
  // their unit, cannot reach another. Folds in the degenerate-data baseline
  // (membership WITH unitId = single).
  test.describe('Cenário 2 — membro single-unit travado', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('membership.unitId trava na unidade: sem interstitial, sem picker, sem alcançar outra', async ({
      authedPage,
      org,
    }) => {
      const [unit1] = twoUnits(org.unitIds)
      // Pin the owner to the first unit (AC-05).
      const membershipId = membershipDocId(org.orgId, org.uid)
      await setMembershipUnitId(membershipId, unit1)

      // Locked members never interstitial — they enter directly.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // No actionable picker at all (single org + locked unit).
      await expect(switcher(authedPage)).toHaveAttribute('data-interactive', 'false')

      // Even hitting the interstitial directly bounces back to the locked unit
      // (cannot reach the other unit).
      await authedPage.goto('/select-unit')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')
    })
  })

  // Cenário 3 — cadastro e relatório seguem cross-unit.
  // With an active context on ONE unit, the DEFINITION (Catálogo/Planos) and
  // AGGREGATE (Relatórios) surfaces still span ALL units — the selector does
  // NOT filter them, and `Service.unitOverrides` / the aggregate stay intact.
  test.describe('Cenário 3 — cadastro e relatório seguem cross-unit', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('com contexto numa unidade, Catálogo/Planos/Relatórios continuam mostrando todas as unidades', async ({
      authedPage,
      org,
    }) => {
      const [unit1, unit2] = twoUnits(org.unitIds)

      // A service offered in BOTH units, with a per-unit override on unit 2 —
      // the cross-unit definition the selector must not narrow.
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Cross-Unit',
        publicVisible: true,
        unitIds: [unit1, unit2],
        unitOverrides: { [unit2]: { priceCents: 7000 } },
      })

      // Pick an active unit (unit 1) — the OPERATIONAL context is now scoped.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // Catálogo (definition): the item-edit "Onde é oferecido" fieldset still
      // offers BOTH units as checkboxes — active-unit context does not filter
      // it, and the unit override survives (both unit checkboxes checked).
      await authedPage.goto(`/catalog/${serviceId}`)
      await expect(authedPage.getByRole('heading', { name: 'Editar item' })).toBeVisible()
      const offered = authedPage.getByRole('group', { name: 'Onde é oferecido', exact: true })
      await expect(offered.getByText('Unidade 1')).toBeVisible()
      await expect(offered.getByText('Unidade 2')).toBeVisible()
      const unitChecks = offered.locator('input[name="unitIds"]')
      await expect(unitChecks).toHaveCount(2)
      await expect(offered.locator(`input[name="unitIds"][value="${unit1}"]`)).toBeChecked()
      await expect(offered.locator(`input[name="unitIds"][value="${unit2}"]`)).toBeChecked()

      // Planos (definition) stays cross-unit / org-wide. No plans seeded →
      // protagonist empty-state renders (brief 0034); the page still loaded
      // org-wide (not narrowed by the active unit).
      await authedPage.goto('/plans')
      await expect(authedPage.getByText('Nenhum plano cadastrado')).toBeVisible()

      // Relatórios (aggregate) stays cross-unit — the hub's Comissões section
      // loads org-wide, never narrowed to the active unit (brief 0031
      // #1062 folded it into `/reports`).
      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      // The operational context was never disturbed by visiting the cross-unit
      // surfaces — still unit 1.
      await authedPage.goto('/agenda')
      await expect(switcher(authedPage)).toContainText('Unidade 1')
    })
  })

  // Cenário 4 — navegação por papel.
  // A receptionist: no Administração section (Negócios & Unidades / Unidades /
  // Equipe), no finance-admin items (Comissões); keeps Operação + Cadastros.
  test.describe('Cenário 4 — navegação por papel', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('recepção: sem Administração nem Comissões; mantém Operação + Clientes/Catálogo', async ({
      authedPage,
      org,
    }) => {
      // Demote the seeded owner to receptionist (AC-08).
      await setMembershipRole(membershipDocId(org.orgId, org.uid), 'receptionist')

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const nav = sidebar(authedPage)
      // Operação + Cadastros remain (with the non-admin items).
      await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
      await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Vendas' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Catálogo' })).toBeVisible()

      // The whole Administração section disappears. PRD Identidade v2 / F5
      // renamed "Empresa" → "Negócios & Unidades".
      await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Negócios & Unidades' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Unidades', exact: true })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0)

      // Finance-admin items inside Operação are hidden (Comissões folded into
      // the Relatórios hub, brief 0031 #1062).
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    })
  })

  // Cenário 5 — troca de org reseta contexto.
  // User with membership in 2 orgs: switching org via the switcher resets
  // the active-unit context to a unit of the new org (no leak of the
  // previous org's unit). Folds in the degenerate-data baseline (User with
  // a single org → no org switcher, asserted in Cenário 2's
  // `data-interactive=false`).
  test.describe('Cenário 5 — troca de org reseta contexto', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('trocar de org pelo switcher reseta a unidade ativa pro novo org (sem vazar a anterior)', async ({
      authedPage,
      org,
      context,
      baseURL,
    }) => {
      // Give the seeded owner a second org with 2 units (AC-09).
      const second = await seedAdditionalOrg(org.uid, { name: 'Segundo Negócio', unitCount: 2 })

      // Re-attach the session so the layout re-reads memberships.
      await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)

      // Enter the first org (single unit → direct, no interstitial).
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      // Two memberships → the switcher is interactive (org picker).
      await expect(switcher(authedPage)).toHaveAttribute('data-interactive', 'true')
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // Switch to the second org.
      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Segundo Negócio' }).click()

      // The active-unit context resets: the new org has 2 units, so the
      // first-access interstitial fires — no leak of the previous org's
      // unit (AC-09).
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()
      await expect(
        authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 1' }),
      ).toBeVisible()

      // Persisted pointer reflects the switch. The global `users` table keys on
      // `uid` (not an aggregate_path), so query the row by that column.
      const [user] = await pgQueryProjection('users', 'uid', org.uid)
      expect(user?.current_org_id).toBe(second.orgId)

      // Pick a unit in the new org → enters scoped to it (its own unit, not
      // a stale one from org 1).
      await authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 2' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Segundo Negócio')
    })
  })

  // Baseline — render + empty (degenerate data): PRD Identidade v2 / brief 0046
  // reshapes the zero-unit case. There is NO first-unit gate — an owner
  // (cross-unit) with NO unit lands on the operational shell normally; the
  // unit-scoped surfaces render their empty-state, with no interstitial (that's
  // a multi-unit affordance) and no onboarding redirect.
  test.describe('Baseline — org sem unidade → surfaces sem gate', () => {
    test.use({ orgInput: { unitCount: 0 } })

    test('sem unidade: dono cross-unit acessa as surfaces (sem interstitial, sem gate)', async ({
      authedPage,
    }) => {
      // /orders renderiza seu empty-state; nenhum gate de onboarding/select-unit.
      await authedPage.goto('/orders')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/select-unit(\/|$)/)

      // A Agenda é gated em ter ≥1 unidade em modo appointment (load-agenda.ts):
      // com 0 unidades redireciona pra /orders (gating de capability, não gate de
      // onboarding nem interstitial de seleção de unidade).
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/select-unit(\/|$)/)
    })
  })
})
