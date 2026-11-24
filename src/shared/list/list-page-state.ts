export type ListSurfaceState = 'empty' | 'filtered-empty' | 'populated'

export function resolveListSurfaceState({
  hasAnyData,
  visibleCount,
}: {
  hasAnyData: boolean
  visibleCount: number
}): ListSurfaceState {
  if (!hasAnyData) return 'empty'
  if (visibleCount <= 0) return 'filtered-empty'
  return 'populated'
}
