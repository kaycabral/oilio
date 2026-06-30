import type { Customer } from '@/domain'
import { filterBySearch } from '@/shared/list/filter-by-search'

// Functional core for the customers-list search: match by NAME (substring) OR by
// WhatsApp (digit-to-digit). The stored number is digits with the `55` DDI
// (e.g. `5592900000000`), so we compare the digits of the query against the
// digits of the stored number — a masked query like "(92) 90000-0000",
// "92900000000" or "5592…" all hit regardless of formatting. Pure + sorted by
// name (pt-BR, accent-insensitive) so the shell stays a thin I/O wrapper.
export function searchCustomers(customers: readonly Customer[], query: string): Customer[] {
  const merged = new Set<Customer>(filterBySearch(customers, query, (c) => [c.name]))
  const queryDigits = query.replace(/\D/g, '')
  if (queryDigits.length > 0) {
    for (const c of customers) {
      if (c.whatsapp.replace(/\D/g, '').includes(queryDigits)) merged.add(c)
    }
  }
  // Always name-sorted (pt-BR, accent-insensitive) so the core owns the order —
  // callers don't have to pre-sort, and the union path can't reorder the result.
  return Array.from(merged).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
}
