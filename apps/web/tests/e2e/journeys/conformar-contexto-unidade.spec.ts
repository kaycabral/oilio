// Feature-level E2E — parent #1088 (epic 0039 "Conformar app ao contexto de unidade").
//
// This is the PARENT's composite journey: it validates the brief's Definition
// of Done end-to-end (Cenários 1–4 + baseline), NOT the granular per-AC
// coverage the sub-issue specs already prove exhaustively against the emulator:
//   - units/units-gated-cross-unit.spec.ts            (#1089 · AC-05 — /units
//     gated by operatesCrossUnit)
//   - conformance/operational-follows-active-unit.spec.ts (#1090 · AC-01 —
//     Dashboard/Notificações follow the active unit, no per-feature switcher)
//   - catalog/definition-defaults-active-unit.spec.ts (#1092 · AC-03 — definition
//     forms pre-check the active unit, multi-select preserved)
//
// Brief 0044 (#1120) superseded 0039's aggregate: the cross-unit aggregate view
// ("Todas as unidades") was removed, so Cenário 3 below now asserts that every
// surface reads ONLY the active unit (no toggle, `?units=all` is a dead param).
//
// Here we re-assert the SAME invariants stitched into the one journey the
// owner/manager/member lives:
//   - the OPERATIONAL surfaces (Dashboard, Notificações) follow the ACTIVE UNIT
//     from the shared top context (0029) and switching it via the top switcher
//     (labelled "Contexto da unidade") moves them together — there is NO
//     per-feature unit filter/switcher (the old `?unit=` / notifications unit
//     toggle are gone);
//   - the DEFINITION forms (Catálogo novo item, edição de unidades de um
//     profissional) pre-check the active unit by default, but keep the multi-unit
//     selection from 0012 (other units still checkable / existing selection kept);
//   - every surface (Dashboard, /reports) reads ONLY the active unit (brief
//     0044): there is no aggregate toggle and forcing `?units=all` does not
//     aggregate — switching unit is the only way to see another unit's data;
//   - `/units` (manage the set) is GATED to who operates cross-unit
//     (`canManageOrg && unitId == null`): owner + org-wide manager manage
//     it (and creating a 2nd unit still works); a unit-bound manager / receptionist
//     / memberOperation is redirected to `/agenda`;
//   - baseline: operational screens render + empty with the active unit and no
//     orphan unit controls; switching the unit reflects across screens; creating
//     a 2nd unit as owner still works; degenerate (unit-bound member has no
//     aggregate/`/units` option; 1-unit org has no selector).
//
// Runs against the running emulator (no mocks). Seeds via the session helpers +
// Firestore REST admin bypass and reads order/notification state straight from
// Firestore to assert the stitched invariants. The active unit is pinned with
// `setActiveUnitCookie` for multi-unit orgs to skip the interstitial where the
// journey is about the scoped surface (not the picker itself).

import { membershipDocId } from '@/domain'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { enableUnitBusinessHours } from '../helpers/forms'
import { listItem } from '../helpers/list'
import { oneUnit, twoUnits } from '../helpers/rest-json'
import {
  seedClosedOrder as centralSeedClosedOrder,
  seedOpenOrder as centralSeedOpenOrder,
  seedCustomer,
  setActiveUnitCookie,
  setMembershipRole,
  setMembershipUnitId,
  type SeededOrg,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

const switcher = (page: Page) => page.getByLabel('Contexto da unidade')

// The "Faturamento" KPI card — scoped so its value doesn't collide with the
// "Ticket médio" card (single-order units make revenue == avg ticket). Mirrors
// the #1091 sub-spec's helper.
function revenueCard(page: Page): Locator {
  return page
    .locator('div')
    .filter({ hasText: /^Faturamento/ })
    .last()
}

// Seeds a closed order in a unit within the default dashboard window (now), so
// it counts toward that unit's revenue KPI. Routes through the central typed
// helper (complete, schema-valid Order). Attribution is the seeded owner; only
// the unit-scoped revenue total is asserted.
async function seedClosedOrder(org: SeededOrg, unitId: string, totalCents: number): Promise<void> {
  await centralSeedClosedOrder({
    orgId: org.orgId,
    unitId,
    customerId: null,
    attributedUserId: org.uid,
    totalCents,
  })
}

// Seeds an open Order projection backdated >24h so it surfaces as a stale
// comanda pendency on the dashboard, scoped to its unit. Mirrors #1090. Routes
// through the central typed helper, backdating `createdAt` so the >24h staleness
// threshold (`selectOpenOrderPendencies`) is met.
async function seedStaleOpenOrder(
  org: SeededOrg,
  unitId: string,
  customerId: string,
  totalCents: number,
): Promise<void> {
  await centralSeedOpenOrder({
    orgId: org.orgId,
    unitId,
    customerId,
    attributedUserId: org.uid,
    totalCents,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  })
}

test.describe('Conformar app ao contexto de unidade — DoD (#1088 · 0039)', () => {
  // Cenário 1 — operação segue a unidade ativa, sem switcher por-feature.
  // With unit X active (top selector), Dashboard + Notificações show unit X's
  // data and have NO per-feature unit control; switching via the top switcher
  // moves them together. Folds in the render+empty + switch-reflects baseline.
  test.describe('Cenário 1 — operação segue a unidade ativa, sem switcher por-feature', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('Dashboard/Notificações mostram a unidade ativa, sem filtro próprio; trocar no topo reflete em todas', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = twoUnits(org.unitIds)

      // One distinct stale open order per unit → dashboard pendency by amount.
      const custA = await seedCustomer(org.orgId, { name: 'Cliente Unidade A' })
      const custB = await seedCustomer(org.orgId, { name: 'Cliente Unidade B' })
      await seedStaleOpenOrder(org, unitA, custA, 11100)
      await seedStaleOpenOrder(org, unitB, custB, 22200)

      // First access: a 2-unit member picks a unit before any surface — the
      // render+empty baseline (interstitial on first access).
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // --- Active unit = A ---
      // Dashboard pendências show only unit A's stale order, and there is NO
      // per-feature unit filter anymore (the old `?unit=` select is gone).
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 222,00')).toBeHidden()
      await expect(authedPage.getByRole('combobox', { name: 'Unidade' })).toHaveCount(0)

      // Notificações scope to the active unit; no orphan unit toggle inside the
      // page content (the top switcher's name also contains a unit name, so the
      // negative assertion is scoped to the inner `<main class="... p-6">`).
      await authedPage.goto('/notifications')
      await expect(authedPage.getByRole('heading', { name: 'Notificações' })).toBeVisible()
      const notificationsMain = authedPage.locator('main.p-6')
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 1', exact: true }),
      ).toHaveCount(0)
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 2', exact: true }),
      ).toHaveCount(0)

      // --- Switch to unit B via the TOP switcher → screens reflect together ---
      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 2')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByText('R$ 222,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeHidden()
    })
  })

  // Cenário 2 — definição default na ativa, multi-select preservado.
  // With unit X active, a NEW catalog item pre-checks unit X by default but the
  // owner can still check other units; editing a memberOperation's units keeps the
  // existing multi-unit selection (the default never collapses it).
  test.describe('Cenário 2 — definição default na ativa, multi-select preservado', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('novo item pré-marca a unidade ativa (multi-select preservado); editar profissional mantém a seleção atual', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitOne, unitTwo] = twoUnits(org.unitIds)

      // Make "Unidade 2" the active unit (not the default first-by-name).
      await setActiveUnitCookie(context, unitTwo, baseURL ?? undefined)

      // --- New catalog item: active unit pre-checked, others still checkable ---
      await authedPage.goto('/catalog/new')
      await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
      const offered = authedPage.getByRole('group', { name: 'Onde é oferecido', exact: true })
      // Design Checkbox is a button (role=checkbox); the `input[name]` is its
      // hidden form mirror — drive the visible box via its enclosing label.
      const unitBox = (id: string) =>
        offered
          .locator('label')
          .filter({ has: authedPage.locator(`input[name="unitIds"][value="${id}"]`) })
          .getByRole('checkbox')
      const newUnitOne = unitBox(unitOne)
      const newUnitTwo = unitBox(unitTwo)
      await expect(newUnitTwo).toBeChecked()
      await expect(newUnitOne).not.toBeChecked()
      // Multi-select preserved (0012): the other unit is still checkable.
      await newUnitOne.check()
      await expect(newUnitOne).toBeChecked()
      await expect(newUnitTwo).toBeChecked()

      // --- Editing a memberOperation's units keeps the existing selection ---
      // The seeded memberOperation is linked to BOTH units. The active-unit default
      // must NOT collapse that down to just the active unit.
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]}`
      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)
      const unitsGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      await expect(unitsGroup.locator(`input[name="unitIds"][value="${unitOne}"]`)).toBeChecked()
      await expect(unitsGroup.locator(`input[name="unitIds"][value="${unitTwo}"]`)).toBeChecked()
    })
  })

  // Cenário 3 — tudo na unidade ativa, sem agregado (brief 0044).
  // O dashboard lê só a unidade ativa: sem toggle "Todas as unidades", e
  // forçar `?units=all` NÃO agrega (param morto). Só trocar de unidade pelo
  // switcher revela os dados de outra unidade.
  test.describe('Cenário 3 — tudo na unidade ativa, sem agregado', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('dashboard escopa só na unidade ativa; sem toggle e ?units=all não agrega', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = twoUnits(org.unitIds)
      // Distinct revenue per unit: A=R$ 100,00, B=R$ 250,00. O agregado (R$
      // 350,00) NÃO deve aparecer em nenhuma superfície.
      await seedClosedOrder(org, unitA, 10000)
      await seedClosedOrder(org, unitB, 25000)

      // Owner 2-unidades → interstitial; escolhe A.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      // Dashboard: sem toggle, escopado em A.
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      await expect(revenueCard(authedPage).getByText('R$ 100,00')).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 350,00')).toBeHidden()

      // Forçar `?units=all` não agrega: continua em A (param morto).
      await authedPage.goto('/dashboard?units=all')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      await expect(revenueCard(authedPage).getByText('R$ 100,00')).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 350,00')).toBeHidden()

      // Trocar pra B pelo switcher revela os dados de B (não o agregado).
      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 2')
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 250,00')).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 350,00')).toBeHidden()
    })
  })

  // Cenário 4 — `/units` gated a quem opera cross-unit.
  // Owner (cross-unit) manages the set at `/units` and creating a 2nd unit still
  // works; a unit-bound manager (canManageOrg but unitId != null) is
  // redirected to `/agenda`. Folds in the create-2nd-unit baseline.
  test.describe('Cenário 4 — `/units` gated a quem opera cross-unit', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('dono gere /units e cria 2ª unidade; gerente vinculado a uma unidade é redirecionado pra /agenda', async ({
      org,
      authedPage,
    }) => {
      // --- Owner (cross-unit): manages the set, creates a 2nd unit ---
      // `/units` folded into the Negócios & Unidades surface (`/organizations`);
      // creation is the inline "+ Nova unidade" dialog there (PRD Identidade v2).
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      await expect(authedPage.getByRole('heading', { name: 'Negócios' })).toBeVisible()

      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      // O diálogo abre SOBRE a listagem (que já tem "Unidade 1"): escopa todos os
      // locators de criação ao dialog pra evitar strict-mode violations.
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro Velho')
      await expect(dialog.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'filial-centro-velho',
      )
      await expect(dialog.getByText(/disponível/i)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      await dialog.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(dialog.getByText(/São Paulo\/SP/)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Número' }).fill('200')
      // v2: horário de funcionamento é obrigatório — habilita um dia.
      await enableUnitBusinessHours(dialog)
      await dialog.getByRole('button', { name: 'Criar' }).click()

      // Now multi-unit with no chosen unit → the interstitial proves the create.
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByRole('button', { name: 'Filial Centro Velho' })).toBeVisible()
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      // The migrated `UnitsList` lists units by name (no slug column).
      await expect(listItem(authedPage, /Filial Centro Velho/)).toBeVisible()

      // --- Degenerate: a unit-bound manager loses access (redirect /agenda) ---
      const membershipId = membershipDocId(org.orgId, org.uid)
      const [unit1] = oneUnit(org.unitIds)
      await setMembershipRole(membershipId, 'manager')
      await setMembershipUnitId(membershipId, unit1)

      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      // Cannot bypass via deep-link to the create form either.
      await authedPage.goto('/units/new')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })

  // Baseline degenerate — 1-unit org: no selector, no aggregate, and a
  // unit-bound member there has neither aggregate nor `/units` access. The
  // single-unit lock is asserted via the top switcher being non-interactive,
  // and the aggregate/`/units` gating via a demoted receptionist.
  test.describe('Baseline — org 1 unidade sem seletor; membro unit-bound sem agregado/units', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('1 unidade: switcher não interativo, sem agregado; recepção não acessa /units (redirect)', async ({
      org,
      authedPage,
    }) => {
      // Demote the seeded owner to a receptionist (unit-scoped member).
      const membershipId = membershipDocId(org.orgId, org.uid)
      await setMembershipRole(membershipId, 'receptionist')

      // Single-unit org → enters directly, no interstitial, no actionable
      // selector (single org + single unit).
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')
      await expect(switcher(authedPage)).toHaveAttribute('data-interactive', 'false')

      // Dashboard: no aggregate toggle (1 unit + unit-scoped role).
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)

      // `/units` is denied for a receptionist (not cross-unit) → /agenda.
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })
})
