import { hasValidCheckDigit } from './check-digit'
import { classifyPrefix } from './prefix'
import type { FallbackIdentity, GtinResult } from './types'

const VALID_LENGTHS = new Set([8, 12, 13, 14])

export function validateGtin(input: string): GtinResult {
  const raw = input.trim().replace(/[\s-]/g, '')

  if (raw === '') return { kind: 'rejected', reason: 'empty' }
  if (!/^\d+$/.test(raw)) return { kind: 'rejected', reason: 'non-numeric' }
  if (!VALID_LENGTHS.has(raw.length)) return { kind: 'rejected', reason: 'invalid-length' }
  if (!hasValidCheckDigit(raw)) return { kind: 'rejected', reason: 'check-digit' }

  const prefixClass = classifyPrefix(raw)
  if (prefixClass !== 'accept') return { kind: 'rejected', reason: prefixClass }

  return { kind: 'valid', gtin14: raw.padStart(14, '0') }
}

export function resolveFallback(brand: string, mpn: string): FallbackIdentity | null {
  const b = brand.trim()
  const m = mpn.trim()
  if (b === '' || m === '') return null
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')
  return { kind: 'fallback', brand: b, mpn: m, key: `${norm(b)}::${norm(m)}` }
}
