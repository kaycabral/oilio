import { type Customer, type Order } from '@/domain'

export const COMANDA_STALE_HOURS = 24
export const CUSTOMER_INACTIVE_DAYS = 60
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type OpenOrderPendency = {
  id: string
  unitId: string
  customerId: string | null
  openedAt: string
  totalCents: number
  hoursOpen: number
}

export type InactiveCustomerPendency = {
  id: string
  name: string
  lastSeenAt: string
  daysInactive: number
}

export type DashboardPendencies = {
  openOrders: OpenOrderPendency[]
  inactiveCustomers: InactiveCustomerPendency[]
}

function hoursBetween(startIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(startIso).getTime()) / HOUR_MS))
}

function daysBetween(startIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(startIso).getTime()) / DAY_MS))
}

export function selectOpenOrderPendencies(
  orders: Order[],
  now: Date,
  thresholdHours = COMANDA_STALE_HOURS,
): OpenOrderPendency[] {
  const out: OpenOrderPendency[] = []
  for (const c of orders) {
    if (c.status !== 'open') continue
    const hours = hoursBetween(c.createdAt, now)
    if (hours < thresholdHours) continue
    out.push({
      id: c.id,
      unitId: c.unitId,
      customerId: c.customerId,
      openedAt: c.createdAt,
      totalCents: c.totalCents,
      hoursOpen: hours,
    })
  }
  return out.sort((a, b) => b.hoursOpen - a.hoursOpen)
}

export function selectInactiveCustomerPendencies(
  customers: Customer[],
  now: Date,
  thresholdDays = CUSTOMER_INACTIVE_DAYS,
  limit = 5,
): InactiveCustomerPendency[] {
  const out: InactiveCustomerPendency[] = []
  for (const c of customers) {
    if (daysBetween(c.createdAt, now) < thresholdDays) continue
    const days = daysBetween(c.updatedAt, now)
    if (days < thresholdDays) continue
    out.push({ id: c.id, name: c.name, lastSeenAt: c.updatedAt, daysInactive: days })
  }
  return out.sort((a, b) => b.daysInactive - a.daysInactive).slice(0, limit)
}
