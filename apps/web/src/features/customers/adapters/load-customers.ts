import type { Customer } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { getCustomerById, listActiveCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

export type CustomersPageData = {
  customers: Customer[]
  searchQuery: string
  canDelete: boolean
  state: ListSurfaceState
}

// Imperative shell for the customers list route. Active customers only — a
// blocked (LGPD #1100) or operator-deactivated (#1069) customer drops from the
// management list; their history still resolves elsewhere. Search by name reads
// from the URL (`q`); pagination is client-side.
export async function loadCustomersPage(
  rawParams: { q?: string } = {},
): Promise<CustomersPageData> {
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canDelete = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const searchQuery = rawParams.q ?? ''
  const allCustomers = (await listActiveCustomersForOrg(ctx.membership.orgId)).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
  const customers = filterBySearch(allCustomers, searchQuery, (c) => [c.name])
  const state = resolveListSurfaceState({
    hasAnyData: allCustomers.length > 0,
    visibleCount: customers.length,
  })
  return { customers, searchQuery, canDelete, state }
}

// Imperative shell for the edit route — resolves the customer or null (404).
export async function loadCustomerForEdit(customerId: string): Promise<Customer | null> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  return getCustomerById(ctx.membership.orgId, customerId)
}
