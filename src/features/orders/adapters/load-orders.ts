import { Order, type Customer } from '@/domain'
import { getSessionUser } from '@/shared/auth/session'
import { rowToDoc as orderRowToDoc, type OrderRow } from '@/shared/db/pg/effect/order-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState } from '@/shared/list/list-page-state'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { isSupabaseConfigured } from '@cbrl/supabase'
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

export async function loadOrdersPage(searchParams: {
  status?: string
  q?: string
}): Promise<OrdersPageData> {
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const filter: OrdersFilter =
    searchParams.status === 'closed' || searchParams.status === 'open' ? searchParams.status : 'all'

  const { activeUnitId } = await resolveActiveUnit(ctx.membership)
  if (!activeUnitId) return { kind: 'no-unit' }

  const orgId = ctx.membership.orgId
  const org = await getOrg(orgId)
  const vertical = org?.vertical ?? 'barbershop'
  const isAgendaVertical = vertical === 'barbershop'

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

  const searchQuery = searchParams.q ?? ''
  const orders = filterBySearch(statusSlice, searchQuery, (o) =>
    o.customerId ? [customers[o.customerId]?.name] : [],
  )

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
