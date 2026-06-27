'use client'

import { lookupProductForForm } from '@/features/catalog/adapters/product-lookup.action'
import { searchProductsByNameForForm } from '@/features/catalog/adapters/product-name-search.action'
import {
  clearedCodeState,
  deriveCodeState,
  filledFromSuggestion,
  intrinsicsLocked,
  MIN_SEARCH_TERM_LENGTH,
  nameIsContribution,
  normalizeSearchTerm,
  referenceGtinToWire,
  type CodeFormState,
  type ProductSuggestion,
} from '@/features/catalog/core/catalog-item-form'
import { useEffect, useRef, useState, useTransition } from 'react'

// Debounce for the name search (brief 0055, AC-01) — the combobox fires at most
// one base query per quiet ~250ms window, so typing a name is a few queries, not
// one-per-keystroke.
const NAME_SEARCH_DEBOUNCE_MS = 250

// Imperative shell for the product autofill (brief 0054 § Grupo B + 0055 § Grupo
// B). Owns the derived form state + the live transitions for BOTH bocas — the
// code lookup (C) and the name search (D) — keeping the form component thin. The
// pure derivation lives in the core (`catalog-item-form`); this hook is only the
// React glue (state, the async lookups, debounce, focus-on-hit). Both bocas
// converge on the SAME `filled` state (one source of truth).
export interface ProductCodeAutofill {
  readonly state: CodeFormState
  readonly pending: boolean
  /** Intrinsics are locked (read-only) only on a hit (AC-02). */
  readonly locked: boolean
  /** The base-owned name to render read-only on a hit; null otherwise. */
  readonly filledName: string | null
  /** The name input is required UNLESS the base filled it on a hit. */
  readonly nameRequired: boolean
  /** True on a miss — the name is the deliberate contribution (AC-03). */
  readonly nameIsContribution: boolean
  /**
   * The reference key to wire as a hidden `gtin` so the save references the
   * product — set only when the NAME boca filled the form (the code boca keeps
   * its key in its own input). Null otherwise.
   */
  readonly referenceGtin14: string | null
  /** Current name suggestions from the base (empty unless the user is typing). */
  readonly suggestions: readonly ProductSuggestion[]
  /** True while a name search is in flight (combobox loading hint). */
  readonly searching: boolean
  /** Run the live CODE lookup for a normalized code (Enter/blur). */
  readonly lookup: (code: string) => void
  /** Update the name query — debounced search of the base (≥3 chars). */
  readonly searchByName: (query: string) => void
  /**
   * Abort a pending/in-flight name search WITHOUT clearing the typed name: drops
   * the debounce timer, invalidates the in-flight query, and collapses the list.
   * Wired to the combobox's Escape/dismiss so a search scheduled by the last
   * keystroke can't fire its setState (re-render) AFTER the user moved on — which
   * is what raced the form's submit/redirect. Distinct from `clear`, which also
   * resets the fill state.
   */
  readonly dismissSearch: () => void
  /** Choose a suggestion → fill + lock intrinsics, wire the reference (AC-02). */
  readonly selectSuggestion: (suggestion: ProductSuggestion) => void
  /** Revert to the cleared state when the code field empties (AC-06). */
  readonly clear: () => void
  /** Reset everything — used when the item kind switches away from product. */
  readonly reset: () => void
}

export function useProductCodeAutofill(): ProductCodeAutofill {
  const [state, setState] = useState<CodeFormState>(clearedCodeState())
  const [pending, startLookup] = useTransition()
  const [searching, setSearching] = useState(false)
  const [suggestions, setSuggestions] = useState<readonly ProductSuggestion[]>([])

  // Monotonic request id for the CODE lookup: only the latest may apply its
  // outcome, so a slow earlier request can't overwrite a newer one.
  const requestId = useRef(0)
  // The last code we actually looked up — skip a redundant repeat (Enter commits,
  // then focus moves to price and the code field's blur would re-fire it).
  const lastCode = useRef<string | null>(null)
  // Monotonic request id for the NAME search (separate from the code lookup) +
  // the pending debounce timer, so a newer query supersedes an in-flight one.
  const searchId = useRef(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drop any pending debounced search on unmount (no setState after teardown).
  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    }
  }, [])

  function lookup(code: string): void {
    if (code === lastCode.current) return
    lastCode.current = code
    const id = ++requestId.current
    startLookup(async () => {
      const outcome = await lookupProductForForm(code)
      // A newer lookup superseded this one — drop the stale outcome.
      if (id !== requestId.current) return
      setState(deriveCodeState(outcome))
      // On a hit the intrinsics are filled+locked; move focus to what the user
      // still has to do — price (AC-02). Best-effort: skip if the input is gone.
      if (outcome.status === 'found') focusPrice()
    })
  }

  function runSearch(query: string): void {
    const id = ++searchId.current
    setSearching(true)
    void searchProductsByNameForForm(query)
      .then((results) => {
        // A newer query superseded this one — drop the stale results.
        if (id !== searchId.current) return
        setSuggestions(results)
      })
      .finally(() => {
        if (id === searchId.current) setSearching(false)
      })
  }

  // Tear down any name search: drop a pending debounce, invalidate the in-flight
  // query (so a late result can't repopulate), and collapse the list. The single
  // owner of the name-search teardown — every caller (under-length gate, select,
  // clear) goes through here so they can't diverge.
  function cancelSearch(): void {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    searchId.current++
    setSuggestions([])
    setSearching(false)
  }

  function searchByName(query: string): void {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    // Below the min, never query — collapse the list immediately so it doesn't
    // wait for the debounce (AC-05). Gate on the SAME normalization + constant the
    // engine/server use (not a bare trim/length) so client and server agree on
    // borderline terms (e.g. "a  b" → "a b").
    if (normalizeSearchTerm(query).length < MIN_SEARCH_TERM_LENGTH) {
      cancelSearch()
      return
    }
    debounceTimer.current = setTimeout(() => runSearch(query), NAME_SEARCH_DEBOUNCE_MS)
  }

  function selectSuggestion(suggestion: ProductSuggestion): void {
    // Choosing a suggestion ends the search AND any in-flight code lookup, then
    // converges on the same `filled` state a code hit produces. Invalidating the
    // code lookup (requestId + lastCode) is load-bearing: without it a code lookup
    // that was already in flight could resolve afterwards and overwrite this
    // name-fill (dropping the wired gtin14, since a code hit has gtin14: null).
    cancelSearch()
    requestId.current++
    lastCode.current = null
    setState(filledFromSuggestion(suggestion))
    focusPrice()
  }

  function clear(): void {
    // Invalidate any in-flight lookup/search and forget the last code so
    // re-entering the same code/name looks it up again (AC-06).
    requestId.current++
    lastCode.current = null
    cancelSearch()
    setState(clearedCodeState())
  }

  return {
    state,
    pending,
    locked: intrinsicsLocked(state),
    filledName: state.kind === 'filled' ? state.intrinsics.name : null,
    // A product always needs a name to register; only a hit (base-owned,
    // read-only name) lifts the requirement. So `free` (unrecognized / base
    // unavailable) and `idle` keep the name required — the manual flow is intact.
    nameRequired: !intrinsicsLocked(state),
    nameIsContribution: nameIsContribution(state),
    referenceGtin14: referenceGtinToWire(state),
    suggestions,
    searching,
    lookup,
    searchByName,
    dismissSearch: cancelSearch,
    selectSuggestion,
    clear,
    reset: clear,
  }
}

// Move focus to the price field after a hit — the only thing the user still has
// to do once intrinsics are filled (AC-02). Best-effort: a no-op if absent.
function focusPrice(): void {
  const price = document.getElementById('catalog-priceCents')
  if (price instanceof HTMLInputElement) price.focus()
}
