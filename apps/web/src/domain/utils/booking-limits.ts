// Behavioral scope helpers for Subscription plan rules (brief 0019, Group C).
//
// Pure functions only — no Firestore dep. The Firestore-bound resolver lives
// in `apps/oilio/web/src/lib/public/subscription-scope.ts` and composes
// these helpers across the customer's active subscriptions.
//
// Semantics:
//   - `undefined` (or sub-field undefined) = no restriction on that axis.
//   - Union across multiple scopes follows "most permissive wins":
//       * maxPerDay: max value
//       * maxConcurrent: max value
//       * requireCompleteBeforeNext: AND-collapse (any `false` ⇒ false)
//       * any unrestricted axis on any input collapses that axis to
//         `undefined` (or `false` for the boolean).

import type { BookingLimits } from '../types/subscription-plan'

// Merge two booking-limit scopes into "most permissive" union. Returns
// `null` when neither input restricts any axis. Mirrors
// `mergeAllowedTimeScopes` from time-scope.ts.
export function mergeBookingLimits(
  a: BookingLimits | null | undefined,
  b: BookingLimits | null | undefined,
): BookingLimits | null {
  if (!a && !b) return null
  if (!a) return b ?? null
  if (!b) return a ?? null

  const out: BookingLimits = {}

  // maxPerDay: max wins; either undefined collapses to unrestricted.
  if (a.maxPerDay == null || b.maxPerDay == null) {
    // unrestricted axis
  } else {
    out.maxPerDay = Math.max(a.maxPerDay, b.maxPerDay)
  }

  // maxConcurrent: max wins; either undefined collapses to unrestricted.
  if (a.maxConcurrent == null || b.maxConcurrent == null) {
    // unrestricted axis
  } else {
    out.maxConcurrent = Math.max(a.maxConcurrent, b.maxConcurrent)
  }

  // requireCompleteBeforeNext: AND-collapse — any false ⇒ false (i.e. drop
  // the restriction). Only stays true when both inputs explicitly require it.
  const aReq = a.requireCompleteBeforeNext === true
  const bReq = b.requireCompleteBeforeNext === true
  if (aReq && bReq) out.requireCompleteBeforeNext = true

  if (
    out.maxPerDay == null &&
    out.maxConcurrent == null &&
    out.requireCompleteBeforeNext !== true
  ) {
    return null
  }
  return out
}

// True when the limits payload has no enforceable rule. Callers use this
// as a fast-path bypass to avoid extra Firestore reads.
export function isBookingLimitsUnrestricted(limits: BookingLimits | null | undefined): boolean {
  if (!limits) return true
  return (
    limits.maxPerDay == null &&
    limits.maxConcurrent == null &&
    limits.requireCompleteBeforeNext !== true
  )
}
