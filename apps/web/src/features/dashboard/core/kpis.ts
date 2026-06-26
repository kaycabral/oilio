import type { Appointment, BillingCycle, Order, Subscription } from '@/domain'

export type KpiValue = {
  // Raw value in the natural unit of the metric (cents for money, count for
  // integers, percentage 0–100 for rates).
  value: number
  // Equivalent value for the immediately preceding period, when comparable.
  // Null when the metric is a point-in-time snapshot (MRR/ARR/active subs)
  // or when the previous-period data isn't meaningful.
  previousValue: number | null
}

export type DashboardKpis = {
  mrrCents: KpiValue
  arrCents: KpiValue
  activeSubscribers: KpiValue
  revenueCents: KpiValue
  occupancyPct: KpiValue
  averageTicketCents: KpiValue
}

// Normalize plan price to a monthly equivalent so subs across different
// billing cycles add up to a comparable MRR.
const MONTHLY_DIVISOR: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

export function subscriptionMrrCents(sub: Subscription): number {
  return Math.round(sub.plan.priceCents / MONTHLY_DIVISOR[sub.plan.billingCycle])
}

// Active = the customer can consume benefits. Recovering = last charge failed
// but we still count the subscription as live until it suspends.
const ACTIVE_STATUSES = new Set(['active', 'past_due'])

export function isActiveSubscription(sub: Subscription): boolean {
  return ACTIVE_STATUSES.has(sub.status)
}

export function sumOrderTotals(orders: Order[]): number {
  return orders.reduce((acc, c) => acc + c.totalCents, 0)
}

// Occupancy = past-appointment completion rate. We only count appointments
// whose status has settled (completed | cancelled | no_show) — `scheduled`
// is still in the future and not yet attributed.
export function computeOccupancyPct(appointments: Appointment[]): number {
  let settled = 0
  let completed = 0
  for (const a of appointments) {
    if (a.status === 'completed') {
      completed++
      settled++
    } else if (a.status === 'cancelled' || a.status === 'no_show') {
      settled++
    }
  }
  if (settled === 0) return 0
  return Math.round((completed / settled) * 1000) / 10
}
