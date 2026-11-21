import { logger } from '@cbrl/log'
import { resolveProduct, validateGtin } from '@oilio/product'
import 'server-only'
import { emitProductEvent } from './product-events'
import { getProductSource } from './product-source'

export type ProductGateResult =
  | { readonly kind: 'referenced'; readonly gtin14: string }
  | { readonly kind: 'contributed'; readonly gtin14: string }
  | { readonly kind: 'skipped' }

export async function resolveGate(
  rawGtin: string,
  attrs: { name?: string } = {},
): Promise<ProductGateResult> {
  const startedAt = Date.now()
  const outcome = await resolveProduct(getProductSource(), rawGtin, attrs)
  const latencyMs = Date.now() - startedAt

  if (outcome.kind === 'skipped') {
    return { kind: 'skipped' }
  }

  await emitProductEvent({
    event: 'product_lookup',
    gtin14: outcome.gtin14,
    result: outcome.kind === 'referenced' ? 'hit' : 'miss',
    source: outcome.product.source,
    latencyMs,
  })
  if (outcome.kind === 'contributed') {
    await emitProductEvent({
      event: 'product_autocontributed',
      gtin14: outcome.gtin14,
      source: 'org-contributed',
    })
  }

  return { kind: outcome.kind, gtin14: outcome.gtin14 }
}

export type ProductGateFields = {
  readonly gtin14: string | null
  readonly reconciliationPending?: boolean
  readonly reconciliationLastAttempt?: string
}

export async function runProductGate(
  rawGtin: string,
  attrs: { name?: string } = {},
): Promise<ProductGateFields> {
  try {
    const result = await resolveGate(rawGtin, attrs)
    return { gtin14: result.kind === 'skipped' ? null : result.gtin14 }
  } catch (err) {
    logger.error('base path failed; deferring to reconciliation', { scope: 'runProductGate', err })
    const validated = validateGtin(rawGtin)
    if (validated.kind === 'rejected') {
      return { gtin14: null }
    }
    await emitProductEvent({
      event: 'product_contribution_deferred',
      gtin14: validated.gtin14,
      reason: 'unavailable',
    })
    return {
      gtin14: validated.gtin14,
      reconciliationPending: true,
      reconciliationLastAttempt: new Date().toISOString(),
    }
  }
}
