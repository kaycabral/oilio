import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCepLookup } from './use-cep-lookup'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCepLookup', () => {
  it('surfaces a friendly fixed message on a failed lookup — never the raw error', async () => {
    // A 503 makes the hook throw `CEP lookup failed (503)` internally; the user
    // must NOT see that technical text (disclosure wall, brief 0085).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    )

    const { result } = renderHook(() => useCepLookup('01001000'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Não foi possível consultar o CEP. Tente novamente.')
    // The raw internal message must not leak.
    expect(result.current.error).not.toMatch(/503|CEP lookup failed/i)
  })

  it('does not query and clears error for an incomplete CEP', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useCepLookup('0100'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })
})
