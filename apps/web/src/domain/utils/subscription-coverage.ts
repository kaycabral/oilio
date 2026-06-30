import type { SubscriptionPlanSnapshot } from '../types/subscription'

// Consumption-time coverage resolver (brief 0024, Grupo B — AC-04).
//
// Distinct from the booking-time category scope (#1004,
// `resolveCustomerSubscriptionScope`): there the question is "can this customer
// BOOK a service in this category?"; here the question is "is this catalog item
// COVERED by the subscription's FROZEN snapshot when closing the comanda?".
//
// An item is covered when it's in the plan's explicit `includedItemIds`, OR when
// its category is in `includedCategoryIds` (the convenience expansion — "all
// items of category X"). Both lists are the frozen snapshot copies on the
// subscription (plan edits never retroact, see `SubscriptionPlanSnapshot`).
//
// Kind-agnostic: the resolver answers coverage the same way for a service and a
// product — the CONSUMER specializes (service → covered-attendance count, no
// commission; product → stock decrement). See `closeOrder`.
//
// Unrestricted snapshot = covers everything. When BOTH lists are empty the plan
// places no item/category restriction on coverage — every item is covered. This
// mirrors the booking path (`resolveCustomerSubscriptionScope`), where an empty
// `includedCategoryIds` collapses to "no restriction" (most permissive wins).
export function isItemCoveredBySubscription(
  snapshot: Pick<SubscriptionPlanSnapshot, 'includedItemIds' | 'includedCategoryIds'>,
  item: { id: string; categoryId: string | null },
): boolean {
  if (snapshot.includedItemIds.length === 0 && snapshot.includedCategoryIds.length === 0) {
    return true
  }
  const directlyIncluded = snapshot.includedItemIds.includes(item.id)
  if (directlyIncluded) return true
  // Category convenience: an item whose category is in the snapshot's
  // `includedCategoryIds` is covered even without an explicit item entry. An
  // uncategorized item (`null`) can only be covered by a direct item match.
  return item.categoryId !== null && snapshot.includedCategoryIds.includes(item.categoryId)
}

// One scope-bearing subscription's coverage shape, as resolved at booking time
// (brief 0079, Grupo A — #1305). `remaining` is the period balance: `null` for
// an unlimited plan (always has balance), a count otherwise. Carries only what
// the recognition layer needs — the raw number never reaches the customer UI.
export type SubscriptionCoverageEntry = Pick<
  SubscriptionPlanSnapshot,
  'includedItemIds' | 'includedCategoryIds'
> & {
  remaining: number | null
}

// Booking-time recognition predicate (brief 0079, Grupo A — AC-01/AC-02). An
// item earns the "no seu plano" badge / coverage auto-mark only when SOME
// scope-bearing subscription both COVERS it (`isItemCoveredBySubscription`) and
// still has cycle balance (`remaining > 0`, or unlimited). A covered item whose
// every covering subscription is out of balance falls back to avulso (no badge,
// full price) — AC-04. The balance is consumed only to decide presence here; it
// is never rendered as a number (AC-02).
export function isItemCoveredWithBalance(
  entries: readonly SubscriptionCoverageEntry[],
  item: { id: string; categoryId: string | null },
): boolean {
  return entries.some(
    (e) => (e.remaining === null || e.remaining > 0) && isItemCoveredBySubscription(e, item),
  )
}
