import {
  Charge,
  Subscription,
  type Customer,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@/domain'
import { rowToDoc as chargeRowToDoc, type ChargeRow } from '@/shared/db/pg/effect/charge-projector'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { getCustomerById, listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { listSubscriptionPlansForOrg } from '@/shared/org/subscription-plan-read'
import { Schema } from 'effect'
import { redirect } from 'next/navigation'
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
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  // Default (no param) is the neutral "all"; the sidebar links to `?status=open`
  // to land pre-filtered on the open subscriptions.
  const filter: SubscriptionsFilter =
    rawParams.status === 'cancelled' || rawParams.status === 'open' ? rawParams.status : 'all'
  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const searchQuery = rawParams.q ?? ''

  const orgId = ctx.membership.orgId
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

  return { subscriptions, customers, canManage, filter, searchQuery, state }
}

export type SubscriptionDetailData = {
  subscription: Subscription
  customer: Customer | null
  charges: Charge[]
  activePlans: SubscriptionPlan[]
  canManage: boolean
}

// Single subscription by id for the detail route. Reads the typed projection
// under RLS — `id` is a real column, no correction needed.
async function loadSubscriptionByIdForDetail(
  orgId: string,
  id: string,
): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>('SELECT * FROM subscriptions WHERE aggregate_path = $1', [
        `orgs/${orgId}/subscriptions/${id}`,
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
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const orgId = ctx.membership.orgId
  const subscription = await loadSubscriptionByIdForDetail(orgId, id)
  if (!subscription) return null
  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'

  const [customer, charges, allPlans] = await Promise.all([
    getCustomerById(orgId, subscription.customerId),
    loadChargesForSubscription(orgId, id),
    // Planos ativos pra afford "trocar plano" (ADR 0010, D5 / AC-07). Só
    // carregados pra quem gerencia — assinante/recepção não troca plano.
    canManage ? listSubscriptionPlansForOrg(orgId) : Promise.resolve<SubscriptionPlan[]>([]),
  ])

  const activePlans = allPlans.filter((p) => p.active)

  return { subscription, customer, charges, activePlans, canManage }
}
