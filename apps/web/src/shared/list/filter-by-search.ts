// Case-insensitive substring match over one or more text fields of each item.
// Shared by the list loaders so "search by name" means the same everywhere and
// lives in one place. An empty/blank query returns the set unchanged.
export function filterBySearch<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly (string | null | undefined)[],
): T[] {
  const term = query.trim().toLowerCase()
  if (!term) return [...items]
  return items.filter((item) =>
    fields(item).some((value) => (value ?? '').toLowerCase().includes(term)),
  )
}
