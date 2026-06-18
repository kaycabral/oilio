import {
  Charge,
  Subscription,
  SubscriptionPlan,
  type Customer,
  type SubscriptionStatus,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { getCustomerById, listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

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

  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  let query: FirebaseFirestore.Query<Subscription> = orgRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
  if (filter === 'open') query = query.where('status', 'in', OPEN_STATUSES)
  else if (filter === 'cancelled') query = query.where('status', '==', 'cancelled')
  query = query.orderBy('createdAt', 'desc').limit(200)

  const snap = await query.get()
  const statusSlice = snap.docs.map((d) => ({ ...d.data(), id: d.id }))

  const allCustomers = await listCustomersForOrg(ctx.membership.orgId)
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
    const anySnap = await orgRef.collection('subscriptions').limit(1).get()
    hasAnyData = !anySnap.empty
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

// Imperative shell for the detail route — resolves the subscription or null (404).
export async function loadSubscriptionDetail(id: string): Promise<SubscriptionDetailData | null> {
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  const subSnap = await orgRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(id)
    .get()
  // O `id` no doc fica corrompido pelo replay do event store (o reducer de
  // `subscription.created` projeta `id: actorId`), então derivamos sempre do id
  // real do doc — senão as ações de ciclo de vida miram o doc errado.
  const subData = subSnap.data()
  const subscription = subData ? { ...subData, id: subSnap.id } : undefined
  if (!subscription) return null
  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'

  const [customer, chargesSnap, plansSnap] = await Promise.all([
    getCustomerById(ctx.membership.orgId, subscription.customerId),
    orgRef
      .collection('charges')
      .withConverter(fsConverter(Charge))
      .where('subscriptionId', '==', id)
      .orderBy('dueDate', 'desc')
      .limit(50)
      .get(),
    // Planos ativos pra afford "trocar plano" (ADR 0010, D5 / AC-07). Só
    // carregados pra quem gerencia — assinante/recepção não troca plano.
    canManage
      ? orgRef
          .collection('subscription_plans')
          .withConverter(fsConverter(SubscriptionPlan))
          .where('active', '==', true)
          .get()
      : Promise.resolve(null),
  ])

  const charges = chargesSnap.docs.map((d) => d.data())
  const activePlans = plansSnap ? plansSnap.docs.map((d) => d.data()) : []

  return { subscription, customer, charges, activePlans, canManage }
}
