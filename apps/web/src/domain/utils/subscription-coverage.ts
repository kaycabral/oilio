import type { SubscriptionPlanSnapshot } from '../types/subscription'

export function isItemCoveredBySubscription(
  snapshot: Pick<SubscriptionPlanSnapshot, 'includedItemIds' | 'includedCategoryIds'>,
  item: { id: string; categoryId: string | null },
): boolean {
  if (snapshot.includedItemIds.length === 0 && snapshot.includedCategoryIds.length === 0) {
    return true
  }
  const directlyIncluded = snapshot.includedItemIds.includes(item.id)
  if (directlyIncluded) return true
  return item.categoryId !== null && snapshot.includedCategoryIds.includes(item.categoryId)
}

export type SubscriptionCoverageEntry = Pick<
  SubscriptionPlanSnapshot,
  'includedItemIds' | 'includedCategoryIds'
> & {
  remaining: number | null
}

export function isItemCoveredWithBalance(
  entries: readonly SubscriptionCoverageEntry[],
  item: { id: string; categoryId: string | null },
): boolean {
  return entries.some(
    (e) => (e.remaining === null || e.remaining > 0) && isItemCoveredBySubscription(e, item),
  )
}
