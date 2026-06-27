// Per-worker isolation for the cross-org sovereign product base (`@cbrl/product`).
//
// The base has NO `orgId` (it is cross-org by design — see packages/product
// CLAUDE.md), so the per-org seeding the rest of the suite relies on does not
// apply here. The old model truncated the WHOLE `product` table between specs and
// used shared constant GTINs/names — safe only while no two base-touching specs
// ran concurrently. Under `fullyParallel` + multiple workers (CI runs the e2e
// shards with an uncapped worker count) that invariant breaks: one worker's
// `DELETE FROM product` wipes a row another worker just seeded mid-assert, so the
// autofill form's lookup misses and the create never redirects (flaky, #1228 CI).
//
// The fix is to give each worker its OWN namespace, in BOTH axes the base is keyed
// and searched on:
//   - GTIN-14 — the primary key. Each worker derives unique, GS1-VALID GTINs from
//     its `parallelIndex` (a wrong check digit would be rejected by the form's
//     server-side `validateGtin` before reaching the base, so we compute it with
//     the canonical `computeCheckDigit`).
//   - name — the trigram search (`searchByName`) is fuzzy and GLOBAL (no org
//     filter), so two workers with similar names would cross-match. Each worker
//     suffixes its product names with a worker tag; the search term carries the
//     same tag, so a worker only ever matches its own rows.
//
// Cleanup deletes ONLY the worker's GTINs — never the whole table — so concurrent
// workers never touch each other's rows.

import { computeCheckDigit } from '@cbrl/product'

// Base 10-digit EAN-13 prefixes (data digits, no check digit). Both start with
// `789` (GS1 Brazil) so the form's validator classifies them as legitimate global
// GTINs — NOT restricted-circulation (020–059/200–299) or coupon (980–999), which
// it rejects. The worker slot is woven in before the check digit. Distinct middle
// blocks keep "known" (pre-seeded) and "unseen" (miss → auto-contribute) apart so
// a worker's miss can never collide with its own hit.
//
// IMPORTANT: we build the EAN-13 FIRST (12 data digits + GS1 check digit) and pad
// to GTIN-14 with a single leading zero. The user TYPES the EAN-13, so the EAN-13
// itself must be check-digit-valid; padding to 14 prepends a zero that contributes
// 0 to the weighted sum, preserving the check digit (so the GTIN-14 is valid too).
// (Building 14 first and slicing the leading digit would corrupt the EAN-13's
// check digit whenever that digit is not a pad zero.)
const KNOWN_PREFIX_10 = '7891000100'
const UNSEEN_PREFIX_10 = '7893600029'

/**
 * Build a worker's EAN-13 from a 10-digit prefix + a 2-digit worker slot (0–99),
 * appending the GS1 mod-10 check digit. 10 + 2 = 12 data digits, + 1 check = 13.
 */
function ean13ForWorker(prefix10: string, workerIndex: number): string {
  const slot = String(workerIndex % 100).padStart(2, '0')
  const data12 = prefix10 + slot
  return data12 + String(computeCheckDigit(data12))
}

/**
 * The GTIN/name namespace for a single Playwright worker, derived from its
 * `parallelIndex`. Every base-touching assertion in the spec reads from here, so
 * no two workers ever share a key or a searchable name. Not exported — the spec
 * destructures the fields off `sovereignBaseNamespace`'s return value, so the type
 * stays internal (kept named for the function's return annotation + readability).
 */
type SovereignBaseNamespace = {
  /** A GTIN the spec PRE-SEEDS so a lookup HITS (Scenario 1 / D scenarios). */
  readonly knownGtin14: string
  /** The EAN-13 form of `knownGtin14` (what the user types — the leading zero is the GTIN-14 pad). */
  readonly knownEan13: string
  /** A valid GTIN the spec leaves ABSENT so a lookup MISSES → auto-contributes (Scenario 2). */
  readonly unseenGtin14: string
  /** The EAN-13 form of `unseenGtin14`. */
  readonly unseenEan13: string
  /** Product name for the pre-seeded HIT row — worker-tagged so the fuzzy search is worker-local. */
  readonly knownName: string
  /** Search term (a substring of `knownName`) that surfaces ONLY this worker's row. */
  readonly knownSearchTerm: string
  /** A typo of `knownSearchTerm` (pg_trgm still matches) — still worker-local. */
  readonly knownSearchTypo: string
  /** Name the spec contributes on a MISS — worker-tagged. */
  readonly contributedName: string
  /** Every GTIN this worker may write — the scoped cleanup deletes exactly these. */
  readonly ownedGtins: readonly string[]
}

/**
 * Derive a worker's sovereign-base namespace from its Playwright `parallelIndex`.
 * Pass `testInfo.parallelIndex` (stable per worker process for the run).
 */
export function sovereignBaseNamespace(workerIndex: number): SovereignBaseNamespace {
  const tag = `w${workerIndex}`
  const knownEan13 = ean13ForWorker(KNOWN_PREFIX_10, workerIndex)
  const unseenEan13 = ean13ForWorker(UNSEEN_PREFIX_10, workerIndex)
  return {
    // GTIN-14 = EAN-13 zero-padded (the canonical key; check digit preserved).
    knownGtin14: `0${knownEan13}`,
    knownEan13,
    unseenGtin14: `0${unseenEan13}`,
    unseenEan13,
    // The worker tag rides INSIDE the name so the global trigram search is
    // effectively worker-scoped: `Leite Ninho 400g w0` vs `… w1` never cross-match
    // on a term that includes the tag.
    knownName: `Leite Ninho 400g ${tag}`,
    knownSearchTerm: `ninho ${tag}`,
    // Same typo the legacy spec used ("leit" missing the trailing 'e'), still
    // carrying the worker tag so it stays worker-local.
    knownSearchTypo: `leit ninho ${tag}`,
    contributedName: `Biscoito Recheado 140g ${tag}`,
    ownedGtins: [`0${knownEan13}`, `0${unseenEan13}`],
  }
}
