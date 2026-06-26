'use server'

import {
  suggestionFromResult,
  type ProductSuggestion,
} from '@/features/catalog/core/catalog-item-form'
import { requireManagerCtx } from '@/shared/org/membership'
import { emitProductEvent } from '@/shared/product/product-events'
import { getProductSource } from '@/shared/product/product-source'
import { MIN_SEARCH_TERM_LENGTH, normalizeSearchTerm, searchProductsByName } from '@cbrl/product'

// Live name-autocomplete preview of the sovereign base (brief 0055 § Grupo B,
// AC-01/AC-02). The name boca of feature D — distinct from the code boca
// (product-lookup.action) and from the save gate (product-gate). Reads the base
// as the user types so the combobox can suggest products other businesses
// contributed; choosing one references the product on save, exactly like a code
// hit (the form wires the chosen `gtin14`).
//
// Read-only by construction: it calls `searchProductsByName` (pure search), never
// resolves/contributes. And it is BEST-EFFORT (AC-04): the base is never on the
// critical path — any outage degrades to "no suggestions" (empty), never throws,
// never blocks the cadastro; the field stays an ordinary name input.
export async function searchProductsByNameForForm(rawQuery: string): Promise<ProductSuggestion[]> {
  // Same authz floor as createCatalogItem — only a manager reaches this preview.
  // requireManagerCtx RETURNS a discriminated result (never throws); the `.ok`
  // check is load-bearing — a denied caller degrades to no suggestions (no leak),
  // and the manual flow still works.
  const ctx = await requireManagerCtx()
  if (!ctx.ok) return []

  try {
    const startedAt = Date.now()
    const results = await searchProductsByName(getProductSource(), rawQuery)
    const latencyMs = Date.now() - startedAt

    // An under-length term short-circuits inside the engine to [] without a query.
    // Only emit observability for a term that actually reached the base — so the
    // event count tracks real searches, not keystrokes below the gate. Gate on the
    // SAME constant the engine uses (MIN_SEARCH_TERM_LENGTH) so the telemetry never
    // drifts from the actual query gate if the min length is calibrated.
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
    // The base is NEVER on the critical path (load-bearing invariant of 0050).
    // A failed search degrades the combobox to an ordinary name input — the user
    // types the name and registers manually (or via the code boca).
    console.error('[searchProductsByNameForForm] base search failed; degrading to manual', err)
    return []
  }
}
