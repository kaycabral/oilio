'use server'

import type { CodeLookupOutcome } from '@/features/catalog/core/catalog-item-form'
import { lookupByGtin } from '@/product'
import { requireManagerCtx } from '@/shared/org/membership'
import { emitProductEvent } from '@/shared/product/product-events'
import { getProductSource } from '@/shared/product/product-source'
import { logger, withActionContext } from '@cbrl/log'

export const lookupProductForForm = withActionContext(
  async (rawCode: string): Promise<CodeLookupOutcome> => {
    const ctx = await requireManagerCtx()
    if (!ctx.ok) return { status: 'unavailable' }

    try {
      const startedAt = Date.now()
      const result = await lookupByGtin(getProductSource(), rawCode)
      const latencyMs = Date.now() - startedAt

      if (result.kind === 'invalid') {
        return { status: 'unrecognized' }
      }

      if (result.kind === 'miss') {
        await emitProductEvent({
          event: 'product_lookup',
          gtin14: result.gtin14,
          result: 'miss',
          latencyMs,
        })
        return { status: 'new' }
      }

      const { product } = result
      await emitProductEvent({
        event: 'product_lookup',
        gtin14: result.gtin14,
        result: 'hit',
        source: product.source,
        latencyMs,
      })
      return {
        status: 'found',
        intrinsics: {
          name: product.name,
          brand: product.brand,
          description: product.description,
          photoUrl: product.photoUrl,
          measures: product.measures,
        },
      }
    } catch (err) {
      logger.error('base read failed; degrading to manual', { scope: 'lookupProductForForm', err })
      return { status: 'unavailable' }
    }
  },
)
