import { canManageOrg, type Customer } from '@/domain'
import { searchCustomers } from '@/features/customers/core/search-customers'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { getCustomerById, listActiveCustomersForOrg } from '@/shared/org/customer-read'
import { requireCapabilityPage } from '@/shared/org/membership'
import 'server-only'

export type CustomersPageData = {
  customers: Customer[]
  searchQuery: string
  canDelete: boolean
  state: ListSurfaceState
}

export async function loadCustomersPage(
  rawParams: { q?: string } = {},
): Promise<CustomersPageData> {
  const ctx = await requireCapabilityPage('canManageCustomers')

  const canDelete = canManageOrg(ctx.membership.role)
  const searchQuery = rawParams.q ?? ''
  const allCustomers = (await listActiveCustomersForOrg(ctx.membership.orgId)).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
  const customers = searchCustomers(allCustomers, searchQuery)
  const state = resolveListSurfaceState({
    hasAnyData: allCustomers.length > 0,
    visibleCount: customers.length,
  })

  return { customers, searchQuery, canDelete, state }
}

export async function loadCustomerForView(customerId: string): Promise<Customer | null> {
  const ctx = await requireCapabilityPage('canManageCustomers')
  return getCustomerById(ctx.membership.orgId, customerId)
}
