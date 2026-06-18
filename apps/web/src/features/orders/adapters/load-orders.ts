import { Order, StoredOrg, type Customer } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState } from '@/shared/list/list-page-state'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

export type OrdersFilter = 'open' | 'closed' | 'all'

export type OrdersPageData =
  | { kind: 'no-unit' }
  | {
      kind: 'list'
      filter: OrdersFilter
      filterLabel: string
      searchQuery: string
      isAgendaVertical: boolean
      state: ReturnType<typeof resolveListSurfaceState>
      orders: Order[]
      customers: Record<string, Customer>
    }

// Imperative shell for the orders list route: resolves session/org/active
// unit, loads the unit-scoped orders for the selected status tab plus the
// customer map and list-surface state, and returns a discriminated view-model.
// The route component (page.tsx) stays a thin caller that renders the chrome.
// Status filter is server-side (query); customer-name search is in-memory over
// the status slice; pagination is client-side.
export async function loadOrdersPage(searchParams: {
  status?: string
  q?: string
}): Promise<OrdersPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  // Default (no param) is the neutral "all"; the sidebar links to `?status=open`
  // to land pre-filtered on open sales.
  const filter: OrdersFilter =
    searchParams.status === 'closed' || searchParams.status === 'open' ? searchParams.status : 'all'

  // Comandas are operational (brief 0029, AC-01): scope to the active unit.
  // When the org has no units (activeUnitId === null) there can be no
  // orders, so the list is empty.
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)
  if (!activeUnitId) return { kind: 'no-unit' }

  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  // Vertical ajusta a affordance (brief 0030, AC-03): comércio/varejo (não
  // `barbershop`) não trabalha com agenda, então o empty-state aponta direto pra
  // "Nova venda" em vez de sugerir iniciar atendimento na agenda. O termo é
  // sempre neutro ("Venda") em todas as verticais (brief 0030, AC-09).
  const orgSnap = await orgRef.withConverter(fsConverter(StoredOrg)).get()
  const vertical = orgSnap.data()?.vertical ?? 'barbershop'
  const isAgendaVertical = vertical === 'barbershop'

  let query: FirebaseFirestore.Query = orgRef.collection('orders')
  query = query.where('unitId', '==', activeUnitId)
  if (filter !== 'all') query = query.where('status', '==', filter)
  // orderBy createdAt desc — order mais recente no topo. Não precisa de
  // índice composto por enquanto (status + createdAt seria — adicionar quando
  // performance virar problema).
  query = query.orderBy('createdAt', 'desc').limit(100)

  const ordersSnap = await query.withConverter(fsConverter(Order)).get()
  const statusSlice = ordersSnap.docs.map((d) => d.data())

  const allCustomers = await listCustomersForOrg(ctx.membership.orgId)
  const customers: Record<string, Customer> = Object.fromEntries(allCustomers.map((c) => [c.id, c]))

  // Customer-name search over the status slice (a walk-in sale has no customer,
  // so it only surfaces when there's no query).
  const searchQuery = searchParams.q ?? ''
  const orders = filterBySearch(statusSlice, searchQuery, (o) =>
    o.customerId ? [customers[o.customerId]?.name] : [],
  )

  // Distinguish "no sales in this unit at all" (protagonist) from "this status
  // tab / search is empty" (keep the chrome). The slice is query-filtered by
  // status, so when it's empty check for any order in the active unit.
  const visibleCount = orders.length
  let hasAnyData = visibleCount > 0
  if (!hasAnyData) {
    const anyOrder = await orgRef
      .collection('orders')
      .where('unitId', '==', activeUnitId)
      .limit(1)
      .get()
    hasAnyData = !anyOrder.empty
  }
  const state = resolveListSurfaceState({ hasAnyData, visibleCount })
  const filterLabel = { open: 'Abertas', closed: 'Fechadas', all: 'Todas' }[filter]

  return {
    kind: 'list',
    filter,
    filterLabel,
    searchQuery,
    isAgendaVertical,
    state,
    orders,
    customers,
  }
}
