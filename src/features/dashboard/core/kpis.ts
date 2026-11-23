import type { Appointment, BillingCycle, Order, Subscription } from '@/domain'

export type KpiValue = {
  value: number
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

const MONTHLY_DIVISOR: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

export function subscriptionMrrCents(sub: Subscription): number {
  return Math.round(sub.plan.priceCents / MONTHLY_DIVISOR[sub.plan.billingCycle])
}

const ACTIVE_STATUSES = new Set(['active', 'past_due'])

export function isActiveSubscription(sub: Subscription): boolean {
  return ACTIVE_STATUSES.has(sub.status)
}

export function sumOrderTotals(orders: Order[]): number {
  return orders.reduce((acc, c) => acc + c.totalCents, 0)
}

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
