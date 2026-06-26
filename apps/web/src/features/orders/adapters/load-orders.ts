import { Order, type Customer } from '@/domain'
import { rowToDoc as orderRowToDoc, type OrderRow } from '@/shared/db/pg/effect/order-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState } from '@/shared/list/list-page-state'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { Schema } from 'effect'
import { redirect } from 'next/navigation'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)

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

  const orgId = ctx.membership.orgId
  // Vertical ajusta a affordance (brief 0030, AC-03): comércio/varejo (não
  // `barbershop`) não trabalha com agenda, então o empty-state aponta direto pra
  // "Nova venda" em vez de sugerir iniciar atendimento na agenda. O termo é
  // sempre neutro ("Venda") em todas as verticais (brief 0030, AC-09).
  const org = await getOrg(orgId)
  const vertical = org?.vertical ?? 'barbershop'
  const isAgendaVertical = vertical === 'barbershop'

  // Comandas são operacionais e escopadas pela unidade ativa (brief 0029, AC-01).
  // `orders` tem RLS org-only (a unidade é uma coluna comum, não predicado de
  // RLS — ver 0007_rls_financial_core), então o escopo de unidade é um filtro SQL
  // `unit_id = $2`. Status filter no SQL; orderBy created_at desc (mais recente no
  // topo) + limit 100, espelhando a query Firestore. `created_at` é ISO text —
  // ordena lexicograficamente, equivalente ao desc por instante.
  const params: unknown[] = [orgId, activeUnitId]
  let statusClause = ''
  if (filter !== 'all') {
    params.push(filter)
    statusClause = ` AND status = $${params.length}`
  }
  const orderRows = await readUnderRls<OrderRow>(orgId, (client) =>
    client
      .query<OrderRow>(
        `SELECT * FROM orders WHERE org_id = $1 AND unit_id = $2${statusClause}
           ORDER BY created_at DESC LIMIT 100`,
        params,
      )
      .then((res) => res.rows),
  )
  const statusSlice = orderRows.map((row) => decodeOrder(orderRowToDoc(row)))

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
    const anyOrder = await readUnderRls<{ one: number }>(orgId, (client) =>
      client
        .query<{
          one: number
        }>('SELECT 1 AS one FROM orders WHERE org_id = $1 AND unit_id = $2 LIMIT 1', [
          orgId,
          activeUnitId,
        ])
        .then((res) => res.rows),
    )
    hasAnyData = anyOrder.length > 0
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
