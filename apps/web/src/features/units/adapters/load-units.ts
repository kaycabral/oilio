import {
  operatesCrossUnit,
  UNIT_HOURS_MODES,
  type Org,
  type Unit,
  type UnitHoursMode,
} from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import {
  attachCanDelete,
  unitHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { getUnitById, listUnitsForOrg } from '@/shared/org/unit-read'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

export type UnitsPageData = {
  units: WithCanDelete<Unit>[]
  searchQuery: string
  modeFilter: 'all' | UnitHoursMode
  canDelete: boolean
  state: ListSurfaceState
}

function normalizeModeFilter(value: string | undefined): 'all' | UnitHoursMode {
  return UNIT_HOURS_MODES.find((mode) => mode === value) ?? 'all'
}

// Imperative shell for the units list route. `/units` manages the whole set of
// units (cross-unit definition), so it is gated to memberships that operate
// cross-unit — owner + org-wide manager (brief 0039 AC-05). Search by name +
// the hours-mode filter read from the URL (`q`, `mode`); pagination is
// client-side.
export async function loadUnitsPage(
  rawParams: { q?: string; mode?: string } = {},
): Promise<UnitsPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!operatesCrossUnit(ctx.membership)) redirect('/agenda')

  // Past the gate everyone operates cross-unit, so they can manage the set.
  const canDelete = ctx.membership.role === 'owner'
  const searchQuery = rawParams.q ?? ''
  const modeFilter = normalizeModeFilter(rawParams.mode)

  const storedUnits = await listUnitsForOrg(ctx.membership.orgId)
  // Per-row reference-based flag (brief 0033, AC-03 — #1068 precompute). True
  // when no active professional / future appointment references the unit, so
  // the UI can offer Excluir; otherwise only Arquivar.
  const allUnits = await attachCanDelete(storedUnits, (id) =>
    unitHasActiveReference(ctx.membership.orgId, id),
  )
  const byMode =
    modeFilter === 'all' ? allUnits : allUnits.filter((u) => u.agenda.mode === modeFilter)
  const units = filterBySearch(byMode, searchQuery, (u) => [u.name])

  const state = resolveListSurfaceState({
    hasAnyData: allUnits.length > 0,
    visibleCount: units.length,
  })

  return { units, searchQuery, modeFilter, canDelete, state }
}

export type UnitForEditData = {
  orgId: string
  unit: Unit
  org: Org | null
}

// Imperative shell for the edit route — resolves the unit (404 when missing)
// plus the org (for the public booking QR slug).
export async function loadUnitForEdit(unitId: string): Promise<UnitForEditData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  // Same cross-unit gate as `/units` (brief 0039 AC-05).
  if (!operatesCrossUnit(ctx.membership)) redirect('/agenda')

  const unit = await getUnitById(ctx.membership.orgId, unitId)
  if (!unit) notFound()

  const org = await getOrg(ctx.membership.orgId)
  return { orgId: ctx.membership.orgId, unit, org }
}
