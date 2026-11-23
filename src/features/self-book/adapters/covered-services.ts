import 'server-only'

import { isItemCoveredWithBalance, type PublicCatalogItem } from '@/domain'
import type { CustomerSubscriptionScope } from '@/features/booking/adapters/subscription-scope.repo'
import { track } from '@/shared/lib/track'

export function resolveCoveredServiceIds(args: {
  scope: CustomerSubscriptionScope | null
  catalogServiceItems: PublicCatalogItem[]
  orgId: string
  unitId: string
  userId: string | null
}): ReadonlySet<string> {
  const { scope, catalogServiceItems, orgId, unitId, userId } = args
  if (!scope || scope.coverage.length === 0) return new Set()

  const covered = new Set<string>()
  for (const item of catalogServiceItems) {
    if (isItemCoveredWithBalance(scope.coverage, { id: item.id, categoryId: item.categoryId })) {
      covered.add(item.id)
      if (userId) {
        track('self_book_covered_service_shown', {
          org_id: orgId,
          user_id: userId,
          unit_id: unitId,
          item_ref_id: item.id,
        })
      }
    }
  }
  return covered
}
