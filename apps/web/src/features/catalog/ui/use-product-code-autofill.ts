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

const NAME_SEARCH_DEBOUNCE_MS = 250

export interface ProductCodeAutofill {
  readonly state: CodeFormState
  readonly pending: boolean
  readonly locked: boolean
  readonly filledName: string | null
  readonly nameRequired: boolean
  readonly nameIsContribution: boolean
  readonly referenceGtin14: string | null
  readonly suggestions: readonly ProductSuggestion[]
  readonly searching: boolean
  readonly lookup: (code: string) => void
  readonly searchByName: (query: string) => void
  readonly dismissSearch: () => void
  readonly selectSuggestion: (suggestion: ProductSuggestion) => void
  readonly clear: () => void
  readonly reset: () => void
}

export function useProductCodeAutofill(): ProductCodeAutofill {
  const [state, setState] = useState<CodeFormState>(clearedCodeState())
  const [pending, startLookup] = useTransition()
  const [searching, setSearching] = useState(false)
  const [suggestions, setSuggestions] = useState<readonly ProductSuggestion[]>([])

  const requestId = useRef(0)
  const lastCode = useRef<string | null>(null)
  const searchId = useRef(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      if (id !== requestId.current) return
      setState(deriveCodeState(outcome))
      if (outcome.status === 'found') focusPrice()
    })
  }

  function runSearch(query: string): void {
    const id = ++searchId.current
    setSearching(true)
    void searchProductsByNameForForm(query)
      .then((results) => {
        if (id !== searchId.current) return
        setSuggestions(results)
      })
      .finally(() => {
        if (id === searchId.current) setSearching(false)
      })
  }

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
    if (normalizeSearchTerm(query).length < MIN_SEARCH_TERM_LENGTH) {
      cancelSearch()
      return
    }
    debounceTimer.current = setTimeout(() => runSearch(query), NAME_SEARCH_DEBOUNCE_MS)
  }

  function selectSuggestion(suggestion: ProductSuggestion): void {
    cancelSearch()
    requestId.current++
    lastCode.current = null
    setState(filledFromSuggestion(suggestion))
    focusPrice()
  }

  function clear(): void {
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

function focusPrice(): void {
  const price = document.getElementById('catalog-priceCents')
  if (price instanceof HTMLInputElement) price.focus()
}
