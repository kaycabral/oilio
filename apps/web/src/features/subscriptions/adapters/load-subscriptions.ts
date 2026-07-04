import {
  canManageOrg,
  Charge,
  Subscription,
  type Customer,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@/domain'
import { isCapabilityLocked } from '@/features/billing/adapters/capability-lock'
import { rowToDoc as chargeRowToDoc, type ChargeRow } from '@/shared/db/pg/effect/charge-projector'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { getCustomerById, listCustomersForOrg } from '@/shared/org/customer-read'
import { requireCapabilityPage } from '@/shared/org/membership'
import { listSubscriptionPlansForOrg } from '@/shared/org/subscription-plan-read'
import { Schema } from 'effect'
import 'server-only'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)
const decodeCharge = Schema.decodeUnknownSync(Charge)

export type SubscriptionsFilter = 'open' | 'cancelled' | 'all'

export type SubscriptionsPageData = {
  subscriptions: Subscription[]
  customers: Record<string, Customer>
  canManage: boolean
  filter: SubscriptionsFilter
  searchQuery: string
  state: ListSurfaceState
  // `locked` (brief 0088 AC-05): the tier does not unlock `plans.recurring`. The
  // loader returns EMPTY without reading subscriptions OR customers — so no
  // subscription rows and NO customer names (PII) are materialized into the RSC
  // payload for a Free/downgraded org. The page renders the locked state.
  locked: boolean
}

const OPEN_STATUSES: SubscriptionStatus[] = ['pending', 'active', 'past_due', 'suspended']

// Status-filtered subscription slice (brief 0061 § Grupo B). Reads the typed
// projection under RLS — `id` is a real column the projector writes from the
// aggregate id.
async function loadSubscriptionStatusSlice(
  orgId: string,
  filter: SubscriptionsFilter,
): Promise<Subscription[]> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) => {
    if (filter === 'open') {
      return client
        .query<SubscriptionRow>(
          'SELECT * FROM subscriptions WHERE org_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 200',
          [orgId, OPEN_STATUSES],
        )
        .then((res) => res.rows)
    }
    if (filter === 'cancelled') {
      return client
        .query<SubscriptionRow>(
          "SELECT * FROM subscriptions WHERE org_id = $1 AND status = 'cancelled' ORDER BY created_at DESC LIMIT 200",
          [orgId],
        )
        .then((res) => res.rows)
    }
    return client
      .query<SubscriptionRow>(
        'SELECT * FROM subscriptions WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200',
        [orgId],
      )
      .then((res) => res.rows)
  })
  return rows.map((r) => decodeSubscription(subscriptionRowToDoc(r)))
}

// Cheap "does this org have any subscription at all?" existence check —
// `LIMIT 1` under RLS.
async function hasAnySubscription(orgId: string): Promise<boolean> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{ id: string }>('SELECT id FROM subscriptions WHERE org_id = $1 LIMIT 1', [orgId])
      .then((res) => res.rows),
  )
  return rows.length > 0
}

// Imperative shell for the subscriptions list route. Status filter is
// server-side (query); customer-name search is in-memory over the status slice;
// pagination is client-side.
export async function loadSubscriptionsPage(rawParams: {
  status?: string
  q?: string
}): Promise<SubscriptionsPageData> {
  const ctx = await requireCapabilityPage('canManageSubscriptions')

  // Default (no param) is the neutral "all"; the sidebar links to `?status=open`
  // to land pre-filtered on the open subscriptions.
  const filter: SubscriptionsFilter =
    rawParams.status === 'cancelled' || rawParams.status === 'open' ? rawParams.status : 'all'
  const canManage = canManageOrg(ctx.membership.role)
  const searchQuery = rawParams.q ?? ''

  const orgId = ctx.membership.orgId

  // Tier gate BEFORE materializing (brief 0088 AC-05/B1): a Free/downgraded org
  // never has subscriptions NOR customer names read — the RSC payload leaks no
  // list and no PII. Orthogonal to the RBAC gate above (AC-07).
  if (await isCapabilityLocked(orgId, 'plans.recurring')) {
    return {
      subscriptions: [],
      customers: {},
      canManage,
      filter,
      searchQuery,
      state: 'empty',
      locked: true,
    }
  }

  const statusSlice = await loadSubscriptionStatusSlice(orgId, filter)

  const allCustomers = await listCustomersForOrg(orgId)
  const customers: Record<string, Customer> = Object.fromEntries(allCustomers.map((c) => [c.id, c]))

  const subscriptions = filterBySearch(statusSlice, searchQuery, (s) => [
    customers[s.customerId]?.name,
  ])

  // Distinguish "no subscriptions at all" (protagonist) from "filter/search
  // returned 0" (keep the chrome). The slice is query-filtered, so when it's
  // empty we need a cheap unfiltered existence check.
  const visibleCount = subscriptions.length
  let hasAnyData = visibleCount > 0
  if (!hasAnyData) {
    hasAnyData = await hasAnySubscription(orgId)
  }
  const state = resolveListSurfaceState({ hasAnyData, visibleCount })

  return { subscriptions, customers, canManage, filter, searchQuery, state, locked: false }
}

export type SubscriptionDetailData =
  | {
      locked: false
      subscription: Subscription
      customer: Customer | null
      charges: Charge[]
      activePlans: SubscriptionPlan[]
      canManage: boolean
    }
  // `locked` (brief 0088 AC-05/B1): the detail loader returns this WITHOUT
  // reading the subscription, its customer (PII) or its charges — a Free org
  // hitting `/subscriptions/[id]` by URL materializes nothing. Distinct from
  // `null` (a real 404): locked means "exists but the tier hides it".
  | { locked: true }

// Single subscription by id for the detail route. Reads the typed projection
// under RLS — `id` is a real column, no correction needed.
async function loadSubscriptionByIdForDetail(
  orgId: string,
  id: string,
): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>('SELECT * FROM subscriptions WHERE org_id = $1 AND id = $2', [
        orgId,
        id,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscription(subscriptionRowToDoc(row)) : null
}

// Charges of a subscription, most-recent-due first (capped at 50). Reads the
// typed projection under RLS.
async function loadChargesForSubscription(
  orgId: string,
  subscriptionId: string,
): Promise<Charge[]> {
  const rows = await readUnderRls<ChargeRow>(orgId, (client) =>
    client
      .query<ChargeRow>(
        'SELECT * FROM charges WHERE org_id = $1 AND subscription_id = $2 ORDER BY due_date DESC LIMIT 50',
        [orgId, subscriptionId],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeCharge(chargeRowToDoc(r)))
}

// Imperative shell for the detail route — resolves the subscription or null (404).
export async function loadSubscriptionDetail(id: string): Promise<SubscriptionDetailData | null> {
  const ctx = await requireCapabilityPage('canManageSubscriptions')

  const orgId = ctx.membership.orgId

  // Tier gate BEFORE materializing (brief 0088 AC-05/B1): don't read the
  // subscription, its customer PII or its charges for a Free/downgraded org.
  if (await isCapabilityLocked(orgId, 'plans.recurring')) return { locked: true }

  const subscription = await loadSubscriptionByIdForDetail(orgId, id)
  if (!subscription) return null
  const canManage = canManageOrg(ctx.membership.role)

  const [customer, charges, allPlans] = await Promise.all([
    getCustomerById(orgId, subscription.customerId),
    loadChargesForSubscription(orgId, id),
    // Planos ativos pra afford "trocar plano" (ADR 0010, D5 / AC-07). Só
    // carregados pra quem gerencia — assinante/recepção não troca plano.
    canManage ? listSubscriptionPlansForOrg(orgId) : Promise.resolve<SubscriptionPlan[]>([]),
  ])

  const activePlans = allPlans.filter((p) => p.active)

  return { locked: false, subscription, customer, charges, activePlans, canManage }
}
