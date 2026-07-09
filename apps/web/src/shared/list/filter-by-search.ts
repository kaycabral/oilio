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
