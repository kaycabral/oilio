import type { BillingCycle } from '../types/subscription-plan'

const CYCLE_TO_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

export function addMonthsUtc(iso: string, months: number): string {
  const d = new Date(iso)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  const hours = d.getUTCHours()
  const minutes = d.getUTCMinutes()
  const seconds = d.getUTCSeconds()
  const ms = d.getUTCMilliseconds()

  const targetMonth = month + months
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12

  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(day, lastDay)

  return new Date(
    Date.UTC(targetYear, normalizedMonth, targetDay, hours, minutes, seconds, ms),
  ).toISOString()
}

export function computeBillingPeriod(
  startIso: string,
  cycle: BillingCycle,
): { startAt: string; endAt: string } {
  return {
    startAt: startIso,
    endAt: addMonthsUtc(startIso, CYCLE_TO_MONTHS[cycle]),
  }
}

export function computeNextChargeDate(periodEndAtIso: string): string {
  return periodEndAtIso
}

export function isUsageLimitReached(
  consumed: number,
  limit: { kind: 'unlimited' } | { kind: 'count'; quantity: number },
): boolean {
  if (limit.kind === 'unlimited') return false
  return consumed >= limit.quantity
}

export function remainingUsage(
  consumed: number,
  limit: { kind: 'unlimited' } | { kind: 'count'; quantity: number },
): number | null {
  if (limit.kind === 'unlimited') return null
  return Math.max(0, limit.quantity - consumed)
}
