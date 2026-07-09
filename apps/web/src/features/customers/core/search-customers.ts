import type { Customer } from '@/domain'
import { filterBySearch } from '@/shared/list/filter-by-search'

export function searchCustomers(customers: readonly Customer[], query: string): Customer[] {
  const merged = new Set<Customer>(filterBySearch(customers, query, (c) => [c.name]))
  const queryDigits = query.replace(/\D/g, '')
  if (queryDigits.length > 0) {
    for (const c of customers) {
      if (c.mobile.replace(/\D/g, '').includes(queryDigits)) merged.add(c)
    }
  }
  return Array.from(merged).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
}
