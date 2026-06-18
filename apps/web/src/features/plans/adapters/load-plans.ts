import {
  BILLING_CYCLES,
  CatalogItem,
  Category,
  StoredUnit,
  SubscriptionPlan,
  type BillingCycle,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import {
  attachCanDelete,
  planHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { getActiveOrgContext } from '@/shared/org/membership'
import { notFound, redirect } from 'next/navigation'
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
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const canDelete = ctx.membership.role === 'owner'
  const searchQuery = rawParams.q ?? ''
  const cycleFilter = normalizeCycleFilter(rawParams.cycle)
  const statusFilter = normalizeStatusFilter(rawParams.status)

  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(ctx.membership.orgId)
    .collection('subscription_plans')
    .withConverter(fsConverter(SubscriptionPlan))
    .orderBy('name')
    .get()
  // Filtered in-memory (truthy `archivedAt`) so legacy docs without the field
  // still surface.
  const activePlans = snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((p) => !p.archivedAt)
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
  return { plans, searchQuery, cycleFilter, statusFilter, canManage, canDelete, state }
}

export type PlanMasterData = {
  units: StoredUnit[]
  catalogItems: CatalogItem[]
  categories: Category[]
}

async function loadPlanMasterData(orgId: string): Promise<PlanMasterData> {
  const orgRef = getAdminFirestore().collection('orgs').doc(orgId)
  const [unitsSnap, itemsSnap, categoriesSnap] = await Promise.all([
    orgRef.collection('units').withConverter(fsConverter(StoredUnit)).orderBy('name').get(),
    orgRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .orderBy('name')
      .get(),
    orgRef.collection('categories').withConverter(fsConverter(Category)).orderBy('name').get(),
  ])
  // Archived master data (brief 0027, AC-06) is hidden from the coverage
  // pickers; the plan keeps resolving any frozen ids it already references.
  const units = unitsSnap.docs.map((d) => d.data()).filter((u) => !u.archivedAt)
  const catalogItems = itemsSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((it) => !it.archivedAt)
  const categories = categoriesSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((c) => !c.archivedAt)
  return { units, catalogItems, categories }
}

// Imperative shell for the new-plan route: gate to owner/manager then resolve
// the coverage-picker master data.
export async function loadNewPlanPage(): Promise<PlanMasterData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'manager') {
    redirect('/plans')
  }
  return loadPlanMasterData(ctx.membership.orgId)
}

export type EditPlanPageData = PlanMasterData & { plan: SubscriptionPlan }

// Imperative shell for the edit route — gate, resolve the plan (404), then the
// coverage-picker master data.
export async function loadEditPlanPage(planId: string): Promise<EditPlanPageData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'manager') {
    redirect('/plans')
  }
  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  const snap = await orgRef
    .collection('subscription_plans')
    .withConverter(fsConverter(SubscriptionPlan))
    .doc(planId)
    .get()
  const plan = snap.data()
  if (!plan) notFound()
  const masterData = await loadPlanMasterData(ctx.membership.orgId)
  return { plan, ...masterData }
}
