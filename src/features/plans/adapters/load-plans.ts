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
  locked: boolean
}

function normalizeCycleFilter(value: string | undefined): 'all' | BillingCycle {
  return BILLING_CYCLES.find((cycle) => cycle === value) ?? 'all'
}

function normalizeStatusFilter(value: string | undefined): PlanStatusFilter {
  return value === 'active' || value === 'inactive' ? value : 'all'
}

export async function loadPlansPage(
  rawParams: { q?: string; cycle?: string; status?: string } = {},
): Promise<PlansPageData> {
  const ctx = await requireCapabilityPage('canManagePlans')

  const canManage = canManageOrg(ctx.membership.role)
  const canDelete = ctx.membership.role === 'owner'
  const searchQuery = rawParams.q ?? ''
  const cycleFilter = normalizeCycleFilter(rawParams.cycle)
  const statusFilter = normalizeStatusFilter(rawParams.status)

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
  const activePlans = allPlansForOrg.filter((p) => !p.archivedAt)
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
  const units = allUnits.filter((u) => !u.archivedAt)
  const catalogItems = items.filter((it) => !it.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)
  return { units, catalogItems, categories }
}

export type PlanFormPageData = PlanMasterData & { locked: boolean }

export async function loadNewPlanPage(): Promise<PlanFormPageData> {
  const ctx = await requireCapabilityPage('canManagePlans')
  if (await isCapabilityLocked(ctx.membership.orgId, 'plans.recurring')) {
    return { units: [], catalogItems: [], categories: [], locked: true }
  }
  const masterData = await loadPlanMasterData(ctx.membership.orgId)
  return { ...masterData, locked: false }
}

export type EditPlanPageData =
  ({ locked: false; plan: SubscriptionPlan } & PlanMasterData) | { locked: true }

export async function loadEditPlanPage(planId: string): Promise<EditPlanPageData> {
  const ctx = await requireCapabilityPage('canManagePlans')
  const orgId = ctx.membership.orgId
  if (await isCapabilityLocked(orgId, 'plans.recurring')) return { locked: true }
  const plan = await getSubscriptionPlanById(orgId, planId)
  if (!plan) notFound()
  const masterData = await loadPlanMasterData(orgId)
  return { locked: false, plan, ...masterData }
}
