import { shiftDateInTenantTz, toTenantTime, type Order, type Subscription } from '@/domain'

export type TrendPoint = {
  // Local YYYY-MM-DD in tenant tz. Identifies the bucket.
  date: string
  revenueCents: number
  newSubs: number
}

// Enumerates every local day in [fromDate, toDate] (inclusive). Tz arg is
// kept for call-site symmetry — day arithmetic on YYYY-MM-DD doesn't depend
// on tz, but downstream we want the dates to match the tenant calendar.
export function listLocalDays(fromDate: string, toDate: string, tz: string): string[] {
  const out: string[] = []
  let cur = fromDate
  // Safety bound: 366 days max — chart should never span more than a year.
  for (let i = 0; i < 366 && cur <= toDate; i++) {
    out.push(cur)
    cur = shiftDateInTenantTz(cur, 1, tz)
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
    const day = toTenantTime(c.closedAt, tz).dateISO
    const bucket = map.get(day)
    if (bucket) bucket.revenueCents += c.totalCents
  }
  for (const s of subs) {
    const day = toTenantTime(s.createdAt, tz).dateISO
    const bucket = map.get(day)
    if (bucket) bucket.newSubs += 1
  }
  return dayList.map((d) => map.get(d) ?? { date: d, revenueCents: 0, newSubs: 0 })
}
