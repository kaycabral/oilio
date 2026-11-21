'use server'

import {
  suggestionFromResult,
  type ProductSuggestion,
} from '@/features/catalog/core/catalog-item-form'
import { requireManagerCtx } from '@/shared/org/membership'
import { emitProductEvent } from '@/shared/product/product-events'
import { getProductSource } from '@/shared/product/product-source'
import { logger, withActionContext } from '@cbrl/log'
import { MIN_SEARCH_TERM_LENGTH, normalizeSearchTerm, searchProductsByName } from '@oilio/product'

export const searchProductsByNameForForm = withActionContext(
  async (rawQuery: string): Promise<ProductSuggestion[]> => {
    const ctx = await requireManagerCtx()
    if (!ctx.ok) return []

    try {
      const startedAt = Date.now()
      const results = await searchProductsByName(getProductSource(), rawQuery)
      const latencyMs = Date.now() - startedAt

      const queryLen = normalizeSearchTerm(rawQuery).length
      if (queryLen >= MIN_SEARCH_TERM_LENGTH) {
        await emitProductEvent({
          event: 'product_search',
          queryLen,
          resultCount: results.length,
          latencyMs,
        })
      }

      return results.map(suggestionFromResult)
    } catch (err) {
      logger.error('base search failed; degrading to manual', {
        scope: 'searchProductsByNameForForm',
        err,
      })
      return []
    }
  },
)
