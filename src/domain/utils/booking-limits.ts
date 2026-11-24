import type { BookingLimits } from '../types/subscription-plan'

export function mergeBookingLimits(
  a: BookingLimits | null | undefined,
  b: BookingLimits | null | undefined,
): BookingLimits | null {
  if (!a && !b) return null
  if (!a) return b ?? null
  if (!b) return a ?? null

  const out: BookingLimits = {}

  if (a.maxPerDay != null && b.maxPerDay != null) {
    out.maxPerDay = Math.max(a.maxPerDay, b.maxPerDay)
  }

  if (a.maxConcurrent != null && b.maxConcurrent != null) {
    out.maxConcurrent = Math.max(a.maxConcurrent, b.maxConcurrent)
  }

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

export function isBookingLimitsUnrestricted(limits: BookingLimits | null | undefined): boolean {
  if (!limits) return true
  return (
    limits.maxPerDay == null &&
    limits.maxConcurrent == null &&
    limits.requireCompleteBeforeNext !== true
  )
}
