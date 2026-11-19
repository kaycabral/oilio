import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCepLookup } from './use-cep-lookup'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCepLookup', () => {
  it('surfaces a friendly fixed message on a failed lookup — never the raw error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    )

    const { result } = renderHook(() => useCepLookup('01001000'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Não foi possível consultar o CEP. Tente novamente.')
    expect(result.current.error).not.toMatch(/503|CEP lookup failed/i)
  })

  it('preserves the API business message on a failed lookup (ADR 0015 origin boundary)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'CEP não encontrado.' }),
      }),
    )

    const { result } = renderHook(() => useCepLookup('01001000'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('CEP não encontrado.')
  })

  it('does not query and clears error for an incomplete CEP', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useCepLookup('0100'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })
})
