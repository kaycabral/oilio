import {
  BILLING_CYCLES,
  canManageOrg,
  type BillingCycle,
  type CatalogItem,
  type Category,
  type StoredUnit,
  type SubscriptionPlan,
} from '@/domain'
import { isCapabilityLocked } from '@/features/billing/adapters/capability-lock'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { listCategoriesForOrg } from '@/shared/org/category-read'
import {
  attachCanDelete,
  planHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { requireCapabilityPage } from '@/shared/org/membership'
import {
  getSubscriptionPlanById,
  listSubscriptionPlansForOrg,
} from '@/shared/org/subscription-plan-read'
import { listStoredUnitsForOrg } from '@/shared/org/unit-read'
import { notFound } from 'next/navigation'
import 'server-only'

export type PlanStatusFilter = 'all' | 'active' | 'inactive'

export type PlansPageData = {
  plans: WithCanDelete<SubscriptionPlan>[]
  searchQuery: string
  cycleFilter: 'all' | BillingCycle
  statusFilter: PlanStatusFilter
  canManage: boolean
  canDelete: boolean
  state: ListSurfaceState
  // `locked` (brief 0088 AC-05): the tier does not unlock `plans.recurring`. The
  // loader returns EMPTY without ever calling `listSubscriptionPlansForOrg`, so
  // no plan list is materialized into the RSC payload for a Free/downgraded org
  // (disclosure furo). The page renders the locked state instead of the list.
  locked: boolean
}

function normalizeCycleFilter(value: string | undefined): 'all' | BillingCycle {
  return BILLING_CYCLES.find((cycle) => cycle === value) ?? 'all'
}

function normalizeStatusFilter(value: string | undefined): PlanStatusFilter {
  return value === 'active' || value === 'inactive' ? value : 'all'
}

// Imperative shell for the plans list route. Archived plans (brief 0027,
// AC-06) drop from the active management table; they stay resolvable for
// historical subscriptions. Search by name + the cycle/status filters read from
// the URL (`q`, `cycle`, `status`); pagination is client-side.
export async function loadPlansPage(
  rawParams: { q?: string; cycle?: string; status?: string } = {},
): Promise<PlansPageData> {
  const ctx = await requireCapabilityPage('canManagePlans')

  const canManage = canManageOrg(ctx.membership.role)
  const canDelete = ctx.membership.role === 'owner'
  const searchQuery = rawParams.q ?? ''
  const cycleFilter = normalizeCycleFilter(rawParams.cycle)
  const statusFilter = normalizeStatusFilter(rawParams.status)

  // Tier gate BEFORE materializing (brief 0088 AC-05): a Free/downgraded org
  // never has its plan list read from the projection, so the RSC payload carries
  // no plan data. Mirrors `loadNewPlanPage`. RBAC (`requireCapabilityPage`) above
  // and this tier gate are orthogonal — both must pass to see the list (AC-07).
  if (await isCapabilityLocked(ctx.membership.orgId, 'plans.recurring')) {
    return {
      plans: [],
      searchQuery,
      cycleFilter,
      statusFilter,
      canManage,
      canDelete,
      state: 'empty',
      locked: true,
    }
  }

  const allPlansForOrg = await listSubscriptionPlansForOrg(ctx.membership.orgId)
  // Filtered in-memory (truthy `archivedAt`) so legacy docs without the field
  // still surface.
  const activePlans = allPlansForOrg.filter((p) => !p.archivedAt)
  // Per-row reference-based flag (brief 0033, AC-03 — #1068 precompute). True
  // when no active subscription references the plan, so the UI can offer
  // Excluir; otherwise only Arquivar. Orthogonal to the role gate.
  const allPlans = await attachCanDelete(activePlans, (id) =>
    planHasActiveReference(ctx.membership.orgId, id),
  )
  const byCycle =
    cycleFilter === 'all' ? allPlans : allPlans.filter((p) => p.billingCycle === cycleFilter)
  const byStatus =
    statusFilter === 'all'
      ? byCycle
      : byCycle.filter((p) => (statusFilter === 'active' ? p.active : !p.active))
  const plans = filterBySearch(byStatus, searchQuery, (p) => [p.name])
  const state = resolveListSurfaceState({
    hasAnyData: allPlans.length > 0,
    visibleCount: plans.length,
  })
  return {
    plans,
    searchQuery,
    cycleFilter,
    statusFilter,
    canManage,
    canDelete,
    state,
    locked: false,
  }
}

export type PlanMasterData = {
  units: StoredUnit[]
  catalogItems: CatalogItem[]
  categories: Category[]
}

async function loadPlanMasterData(orgId: string): Promise<PlanMasterData> {
  const [allUnits, items, allCategories] = await Promise.all([
    listStoredUnitsForOrg(orgId),
    listCatalogItems(orgId),
    listCategoriesForOrg(orgId),
  ])
  // Archived master data (brief 0027, AC-06) is hidden from the coverage
  // pickers; the plan keeps resolving any frozen ids it already references.
  const units = allUnits.filter((u) => !u.archivedAt)
  const catalogItems = items.filter((it) => !it.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)
  return { units, catalogItems, categories }
}

// `locked` (brief 0082): the tier does not unlock `plans.recurring`, so the
// page renders the upgrade CTA instead of the form — a Free org never reaches a
// plan form that would only fail on submit. `requireCapability` in the action
// stays the real wall.
export type PlanFormPageData = PlanMasterData & { locked: boolean }

// Imperative shell for the new-plan route: gate to owner/manager then resolve
// the coverage-picker master data.
export async function loadNewPlanPage(): Promise<PlanFormPageData> {
  const ctx = await requireCapabilityPage('canManagePlans')
  // Tier gate (brief 0082): on a locked tier the page renders the CTA and the
  // form never mounts, so skip the coverage-picker master-data reads entirely —
  // same "do not fetch gated data" pattern as load-copilot / load-reports.
  if (await isCapabilityLocked(ctx.membership.orgId, 'plans.recurring')) {
    return { units: [], catalogItems: [], categories: [], locked: true }
  }
  const masterData = await loadPlanMasterData(ctx.membership.orgId)
  return { ...masterData, locked: false }
}

export type EditPlanPageData =
  | ({ locked: false; plan: SubscriptionPlan } & PlanMasterData)
  // `locked` (brief 0088 AC-06/B1): the route 404s for a Free org — so DON'T
  // read the plan (no name/PII materialized). Distinct from the 404 the missing
  // plan itself triggers.
  | { locked: true }

// Imperative shell for the edit route — gate first (locked → 404 with nothing
// materialized), then resolve the plan (404) + coverage-picker master data.
export async function loadEditPlanPage(planId: string): Promise<EditPlanPageData> {
  const ctx = await requireCapabilityPage('canManagePlans')
  const orgId = ctx.membership.orgId
  // Tier gate BEFORE reading the plan (brief 0088 B1): a Free/downgraded org
  // materializes no plan data — the page 404s.
  if (await isCapabilityLocked(orgId, 'plans.recurring')) return { locked: true }
  const plan = await getSubscriptionPlanById(orgId, planId)
  if (!plan) notFound()
  const masterData = await loadPlanMasterData(orgId)
  return { locked: false, plan, ...masterData }
}
