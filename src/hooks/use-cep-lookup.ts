'use client'

import { readJson } from '@/shared/http'
import { useEffect, useState } from 'react'

export type PostalCodeLookup = {
  postalCode: string
  state: string
  city: string
  neighborhood: string
  street: string
}

export type CepLookupResult = {
  loading: boolean
  data: PostalCodeLookup | null
  error: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function validateErrorBody(data: unknown): { error?: string } {
  if (!isRecord(data)) throw new Error('Invalid error response')
  if (data.error !== undefined && typeof data.error !== 'string') {
    throw new Error('Invalid error response')
  }
  return { error: data.error }
}

function validatePostalCodeLookup(data: unknown): PostalCodeLookup {
  if (!isRecord(data)) throw new Error('Invalid postal code response')
  const { postalCode, state, city, neighborhood, street } = data
  if (
    typeof postalCode !== 'string' ||
    typeof state !== 'string' ||
    typeof city !== 'string' ||
    typeof neighborhood !== 'string' ||
    typeof street !== 'string'
  ) {
    throw new Error('Invalid postal code response')
  }
  return { postalCode, state, city, neighborhood, street }
}

export function useCepLookup(cep: string): CepLookupResult {
  const digits = cep.replace(/\D/g, '')
  const [data, setData] = useState<PostalCodeLookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (digits.length !== 8) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/postal-code/${digits}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await readJson(r, validateErrorBody).catch((): { error?: string } => ({}))
          if (cancelled) return
          setData(null)
          setError(body.error ?? 'Não foi possível consultar o CEP. Tente novamente.')
          return
        }
        const d = await readJson(r, validatePostalCodeLookup)
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setData(null)
        setError('Não foi possível consultar o CEP. Tente novamente.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [digits])

  return { loading, data, error }
}
