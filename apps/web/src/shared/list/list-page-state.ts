// The three states a list page can be in (brief 0034). The List component owns
// the chrome for each; loaders compute the state from two data signals and the
// page forwards it (as `empty` vs `filtered-empty`) to the List.
//
// - `empty` — the entity has no records at all (no filter narrowing the view).
//   The empty-state protagonist owns the screen: one CTA to create the first
//   item; header/toolbar hidden.
// - `filtered-empty` — records exist, but the current filter/search returns 0.
//   The chrome stays so the user can clear the filter; a "no results" body
//   replaces the list.
// - `populated` — records exist in the current view; normal chrome + list.
export type ListSurfaceState = 'empty' | 'filtered-empty' | 'populated'

/**
 * Resolve the list state from two signals the loader provides:
 *
 * - `hasAnyData` — does the entity have **any** record at all, ignoring the
 *   active filter/search? (the unfiltered existence signal — authoritative)
 * - `visibleCount` — number of records in the **current** (filtered) view.
 *
 * The distinction between "no data" and "filtered-empty" is the whole point: a
 * truly empty entity gets the create protagonist; an entity with data but an
 * empty filter slice keeps its chrome.
 */
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
