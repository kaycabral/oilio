import type {
  CodeLookupOutcome,
  ProductSuggestion,
} from '@/features/catalog/core/catalog-item-form'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProductCodeAutofill } from './use-product-code-autofill'

const lookup = vi.hoisted(() => vi.fn<(code: string) => Promise<CodeLookupOutcome>>())
vi.mock('@/features/catalog/adapters/product-lookup.action', () => ({
  lookupProductForForm: lookup,
}))
const search = vi.hoisted(() => vi.fn<(query: string) => Promise<ProductSuggestion[]>>())
vi.mock('@/features/catalog/adapters/product-name-search.action', () => ({
  searchProductsByNameForForm: search,
}))

const FOUND: CodeLookupOutcome = {
  status: 'found',
  intrinsics: { name: 'Leite', brand: null, description: null, photoUrl: null, measures: null },
}

const SUGGESTION: ProductSuggestion = {
  value: '07891000100103',
  name: 'Leite Ninho 400g',
  brand: 'Nestlé',
  intrinsics: {
    name: 'Leite Ninho 400g',
    brand: 'Nestlé',
    description: null,
    photoUrl: null,
    measures: null,
  },
}

afterEach(() => {
  lookup.mockReset()
  search.mockReset()
  vi.useRealTimers()
})

describe('useProductCodeAutofill — nameRequired (AC-03/AC-08)', () => {
  it('a hit lifts required (base owns the name); every other state keeps it', async () => {
    lookup.mockResolvedValueOnce(FOUND)
    const { result } = renderHook(() => useProductCodeAutofill())

    expect(result.current.nameRequired).toBe(true)

    act(() => result.current.lookup('7891000100103'))
    await waitFor(() => expect(result.current.state.kind).toBe('filled'))
    expect(result.current.nameRequired).toBe(false)
    expect(result.current.locked).toBe(true)
  })

  it('free (unavailable/unrecognized) KEEPS name required — the manual flow needs it', async () => {
    lookup.mockResolvedValueOnce({ status: 'unavailable' })
    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.lookup('7891000100103'))
    await waitFor(() => expect(result.current.state.kind).toBe('free'))
    expect(result.current.nameRequired).toBe(true)
    expect(result.current.locked).toBe(false)
  })

  it('miss marks the name as the contribution and required', async () => {
    lookup.mockResolvedValueOnce({ status: 'new' })
    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.lookup('0036000291452'))
    await waitFor(() => expect(result.current.state.kind).toBe('contributing'))
    expect(result.current.nameIsContribution).toBe(true)
    expect(result.current.nameRequired).toBe(true)
  })
})

describe('useProductCodeAutofill — race + dedup', () => {
  it('a superseded (slower, earlier) lookup never overwrites the newer one', async () => {
    let resolveFirst: (o: CodeLookupOutcome) => void = () => {}
    lookup
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ status: 'new' })

    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.lookup('7891000100103'))
    act(() => result.current.lookup('0036000291452'))
    await waitFor(() => expect(result.current.state.kind).toBe('contributing'))

    await act(async () => {
      resolveFirst(FOUND)
      await Promise.resolve()
    })
    expect(result.current.state.kind).toBe('contributing')
  })

  it('looking up the same code twice in a row only calls the action once (Enter→blur)', async () => {
    lookup.mockResolvedValue({ status: 'new' })
    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.lookup('0036000291452'))
    await waitFor(() => expect(result.current.state.kind).toBe('contributing'))
    act(() => result.current.lookup('0036000291452'))
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('reset clears state and lets the same code be looked up again', async () => {
    lookup.mockResolvedValue(FOUND)
    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.lookup('7891000100103'))
    await waitFor(() => expect(result.current.state.kind).toBe('filled'))

    act(() => result.current.reset())
    expect(result.current.state.kind).toBe('idle')

    act(() => result.current.lookup('7891000100103'))
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2))
  })
})

describe('useProductCodeAutofill — name search (feature D, AC-01/AC-05)', () => {
  beforeEach(() => vi.useFakeTimers())

  it('debounces the search: fires once after the quiet window', async () => {
    search.mockResolvedValue([SUGGESTION])
    const { result } = renderHook(() => useProductCodeAutofill())

    act(() => result.current.searchByName('nin'))
    act(() => result.current.searchByName('ninh'))
    act(() => result.current.searchByName('ninho'))
    expect(search).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('ninho')
    expect(result.current.suggestions).toHaveLength(1)
  })

  it('an under-length term never queries and clears suggestions immediately (AC-05)', async () => {
    search.mockResolvedValue([SUGGESTION])
    const { result } = renderHook(() => useProductCodeAutofill())

    act(() => result.current.searchByName('ninho'))
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(result.current.suggestions).toHaveLength(1)

    act(() => result.current.searchByName('ni'))
    expect(result.current.suggestions).toEqual([])
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('selecting a suggestion fills + locks and wires the reference gtin (AC-02)', () => {
    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.selectSuggestion(SUGGESTION))

    expect(result.current.state.kind).toBe('filled')
    expect(result.current.locked).toBe(true)
    expect(result.current.nameRequired).toBe(false)
    expect(result.current.filledName).toBe('Leite Ninho 400g')
    expect(result.current.referenceGtin14).toBe('07891000100103')
    expect(result.current.suggestions).toEqual([])
  })

  it('a superseded (slower, earlier) search never overwrites the newer one', async () => {
    let resolveFirst: (s: ProductSuggestion[]) => void = () => {}
    search
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([SUGGESTION])

    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.searchByName('leite'))
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    act(() => result.current.searchByName('ninho'))
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(result.current.suggestions).toHaveLength(1)

    await act(async () => {
      resolveFirst([])
      await Promise.resolve()
    })
    expect(result.current.suggestions).toHaveLength(1)
  })

  it('clear resets suggestions and any pending search (AC-06)', async () => {
    search.mockResolvedValue([SUGGESTION])
    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.searchByName('ninho'))
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(result.current.suggestions).toHaveLength(1)

    act(() => result.current.clear())
    expect(result.current.suggestions).toEqual([])
    expect(result.current.state.kind).toBe('idle')
    expect(result.current.referenceGtin14).toBeNull()
  })

  it('selecting clears a PENDING debounce so no stale query fires after the fill', async () => {
    search.mockResolvedValue([SUGGESTION])
    const { result } = renderHook(() => useProductCodeAutofill())

    act(() => result.current.searchByName('ninho'))
    act(() => result.current.selectSuggestion(SUGGESTION))

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(search).not.toHaveBeenCalled()
    expect(result.current.state.kind).toBe('filled')
    expect(result.current.referenceGtin14).toBe('07891000100103')
  })

  it('an in-flight code lookup cannot overwrite a name selection (cross-boca race)', async () => {
    let resolveCode: (o: CodeLookupOutcome) => void = () => {}
    lookup.mockImplementationOnce(() => new Promise((r) => (resolveCode = r)))

    const { result } = renderHook(() => useProductCodeAutofill())
    act(() => result.current.lookup('7891000100103'))
    act(() => result.current.selectSuggestion(SUGGESTION))

    await act(async () => {
      resolveCode(FOUND)
      await Promise.resolve()
    })

    expect(result.current.state.kind).toBe('filled')
    expect(result.current.referenceGtin14).toBe('07891000100103')
  })
})
