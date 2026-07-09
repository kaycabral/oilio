import { shiftDateInOrgTz, toOrgTime, type Order, type Subscription } from '@/domain'

export type TrendPoint = {
  date: string
  revenueCents: number
  newSubs: number
}

export function listLocalDays(fromDate: string, toDate: string, tz: string): string[] {
  const out: string[] = []
  let cur = fromDate
  for (let i = 0; i < 366 && cur <= toDate; i++) {
    out.push(cur)
    cur = shiftDateInOrgTz(cur, 1, tz)
  }
  return out
}

export function bucketByLocalDay(
  orders: Order[],
  subs: Subscription[],
  tz: string,
  dayList: string[],
): TrendPoint[] {
  const empty: TrendPoint = { date: '', revenueCents: 0, newSubs: 0 }
  const map = new Map<string, TrendPoint>(dayList.map((d) => [d, { ...empty, date: d }]))
  for (const c of orders) {
    if (!c.closedAt) continue
    const day = toOrgTime(c.closedAt, tz).dateISO
    const bucket = map.get(day)
    if (bucket) bucket.revenueCents += c.totalCents
  }
  for (const s of subs) {
    const day = toOrgTime(s.createdAt, tz).dateISO
    const bucket = map.get(day)
    if (bucket) bucket.newSubs += 1
  }
  return dayList.map((d) => map.get(d) ?? { date: d, revenueCents: 0, newSubs: 0 })
}
