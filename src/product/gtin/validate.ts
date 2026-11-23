import { hasValidCheckDigit } from './check-digit'
import { classifyPrefix } from './prefix'
import type { FallbackIdentity, GtinResult } from './types'

const VALID_LENGTHS = new Set([8, 12, 13, 14])

/**
 * Validate and normalize a GTIN to the canonical zero-padded GTIN-14 key.
 *
 * Pipeline (pure, no I/O):
 *   1. trim + strip spaces/hyphens (scanners and humans add separators).
 *   2. reject empty / non-numeric / wrong length (8/12/13/14).
 *   3. reject on GS1 mod-10 check digit mismatch.
 *   4. classify the GS1 prefix ON THE ORIGINAL LENGTH (before padding) — reject
 *      restricted-circulation (RCN) and coupon/receipt numbers; accept the rest,
 *      including Bookland EAN (ISBN-13 978/979, ISSN 977) which normalize like any
 *      EAN-13.
 *   5. left-pad with zeros to GTIN-14. The check digit is preserved (leading
 *      zeros contribute 0 to the weighted sum), so it is NEVER recomputed.
 */
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

/**
 * Resolve a fallback identity for an item with NO real GTIN (services,
 * own-manufactured, weighed goods). Returns a normalized `brand+MPN` composite —
 * it does NOT become a GTIN and never touches the sovereign base (PRD: such items
 * are self-contained in the `CatalogItem`). Returns null when either part is blank.
 */
export function resolveFallback(brand: string, mpn: string): FallbackIdentity | null {
  const b = brand.trim()
  const m = mpn.trim()
  if (b === '' || m === '') return null
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')
  return { kind: 'fallback', brand: b, mpn: m, key: `${norm(b)}::${norm(m)}` }
}
