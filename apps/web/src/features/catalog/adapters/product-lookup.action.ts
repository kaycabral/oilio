'use server'

import type { CodeLookupOutcome } from '@/features/catalog/core/catalog-item-form'
import { requireManagerCtx } from '@/shared/org/membership'
import { emitProductEvent } from '@/shared/product/product-events'
import { getProductSource } from '@/shared/product/product-source'
import { lookupByGtin } from '@cbrl/product'

// Live form preview of the sovereign base (brief 0054 § Grupo B, AC-02). Reads
// the base BEFORE save so the form can autofill on a hit — distinct from the
// registration gate (product-gate), which writes on save. Both go through the
// SAME normalization (`validateGtin`, inside `lookupByGtin`) and the SAME source
// singleton, so the preview and the gate can never disagree on the key.
//
// Read-only by construction: it calls `lookupByGtin` (pure lookup), NEVER
// `resolveProduct` — a miss must not auto-contribute here (that happens on save,
// once the user supplies the name). And it is BEST-EFFORT (AC-08): a base outage
// degrades to `unavailable`, never throws, never blocks the cadastro.
export async function lookupProductForForm(rawCode: string): Promise<CodeLookupOutcome> {
  // Same authz floor as createCatalogItem — only a manager reaches this preview.
  // requireManagerCtx RETURNS a discriminated result (it never throws), so the
  // `.ok` check is load-bearing: without it a signed-out / non-manager caller
  // would read the base. A denied caller degrades to `unavailable` (no preview,
  // no leak) — the manual flow still works and the save gate re-checks authz.
  const ctx = await requireManagerCtx()
  if (!ctx.ok) return { status: 'unavailable' }

  try {
    const startedAt = Date.now()
    const result = await lookupByGtin(getProductSource(), rawCode)
    const latencyMs = Date.now() - startedAt

    if (result.kind === 'invalid') {
      // A non-product code never touches the base — the manual flow takes over.
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
    // The base is NEVER on the critical path (load-bearing invariant of 0050).
    // Any failure of the base read degrades the preview to "fill it in yourself"
    // — the save gate still guards the code + marks it for reconciliation.
    console.error('[lookupProductForForm] base read failed; degrading to manual', err)
    return { status: 'unavailable' }
  }
}
