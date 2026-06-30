import { canManageOrg, type Customer } from '@/domain'
import type { InviteUnitOption } from '@/features/customers/ui/ClientInviteForm'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { getCustomerById, listActiveCustomersForOrg } from '@/shared/org/customer-read'
import { requireCapabilityPage } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

export type CustomersPageData = {
  customers: Customer[]
  searchQuery: string
  canDelete: boolean
  state: ListSurfaceState
  // Bookable units (selfBookingPublished) the invite can target.
  inviteUnits: InviteUnitOption[]
}

// Imperative shell for the customers list route. Active customers only — a
// blocked (LGPD #1100) or operator-deactivated (#1069) customer drops from the
// management list; their history still resolves elsewhere. Search by name reads
// from the URL (`q`); pagination is client-side.
export async function loadCustomersPage(
  rawParams: { q?: string } = {},
): Promise<CustomersPageData> {
  // Customers is a balcão/management surface (brief 0075): a self-scoped
  // memberOperation (no `canManageCustomers`) is redirected; recepção/manager pass.
  const ctx = await requireCapabilityPage('canManageCustomers')

  const canDelete = canManageOrg(ctx.membership.role)
  const searchQuery = rawParams.q ?? ''
  const allCustomers = (await listActiveCustomersForOrg(ctx.membership.orgId)).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
  const customers = filterBySearch(allCustomers, searchQuery, (c) => [c.name])
  const state = resolveListSurfaceState({
    hasAnyData: allCustomers.length > 0,
    visibleCount: customers.length,
  })

  // Only units that are actually bookable can receive an invite (the customer
  // would dead-end otherwise) — same gate the action re-checks server-side.
  const inviteUnits: InviteUnitOption[] = (await listUnitsForOrg(ctx.membership.orgId))
    .filter((u) => u.agenda.mode === 'appointment' && u.agenda.selfBookingPublished)
    .map((u) => ({ slug: u.slug, name: u.name }))

  return { customers, searchQuery, canDelete, state, inviteUnits }
}

// Imperative shell for the read-only detail route — resolves the customer or
// null (404). Same capability wall as the list. The establishment only consults
// a customer (#1279); editing the data belongs to the customer (#1278).
export async function loadCustomerForView(customerId: string): Promise<Customer | null> {
  const ctx = await requireCapabilityPage('canManageCustomers')
  return getCustomerById(ctx.membership.orgId, customerId)
}
