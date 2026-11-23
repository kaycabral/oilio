import type { Order } from '@/domain'
import { describe, expect, it } from 'vitest'
import { type SubscriptionActivation, bucketByLocalDay, listLocalDays } from './trend'

const TZ = 'America/Sao_Paulo'

describe('listLocalDays', () => {
  it('enumerates inclusive days', () => {
    expect(listLocalDays('2026-03-13', '2026-03-15', TZ)).toEqual([
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ])
  })
  it('returns a single day when from === to', () => {
    expect(listLocalDays('2026-03-15', '2026-03-15', TZ)).toEqual(['2026-03-15'])
  })
})

describe('bucketByLocalDay', () => {
  function makeTestOrder(closedUtc: string, totalCents: number): Order {
    return {
      id: 'o',
      orgId: 't',
      unitId: 'u',
      customerId: null,
      appointmentId: null,
      status: 'closed',
      items: [],
      discountCents: 0,
      closedAt: closedUtc,
      paymentMethod: null,
      subtotalCents: totalCents,
      totalCents,
      createdAt: '',
      updatedAt: '',
    }
  }
  function sub(activatedUtc: string): SubscriptionActivation {
    return { activatedAt: activatedUtc }
  }

  it('attributes a Brazilian late-night sale to the correct local day', () => {
    const c = makeTestOrder('2026-03-14T02:30:00.000Z', 5000)
    const days = ['2026-03-13', '2026-03-14']
    const result = bucketByLocalDay([c], [], TZ, days)
    expect(result).toEqual([
      { date: '2026-03-13', revenueCents: 5000, newSubs: 0 },
      { date: '2026-03-14', revenueCents: 0, newSubs: 0 },
    ])
  })

  it('sums multiple orders in the same day', () => {
    const days = ['2026-03-14']
    const result = bucketByLocalDay(
      [
        makeTestOrder('2026-03-14T10:00:00.000Z', 1000),
        makeTestOrder('2026-03-14T22:00:00.000Z', 2500),
      ],
      [],
      TZ,
      days,
    )
    expect(result[0]).toEqual({ date: '2026-03-14', revenueCents: 3500, newSubs: 0 })
  })

  it('counts new subs by their activation competence day', () => {
    const days = ['2026-03-14', '2026-03-15']
    const result = bucketByLocalDay(
      [],
      [
        sub('2026-03-14T12:00:00.000Z'),
        sub('2026-03-14T20:00:00.000Z'),
        sub('2026-03-15T01:00:00.000Z'),
      ],
      TZ,
      days,
    )
    expect(result).toEqual([
      { date: '2026-03-14', revenueCents: 0, newSubs: 3 },
      { date: '2026-03-15', revenueCents: 0, newSubs: 0 },
    ])
  })

  it('attributes a retroactive sub to its competence day, not the write date (#1420)', () => {
    const days = ['2026-03-13', '2026-03-14', '2026-03-15']
    const result = bucketByLocalDay([], [sub('2026-03-13T09:00:00.000Z')], TZ, days)
    expect(result).toEqual([
      { date: '2026-03-13', revenueCents: 0, newSubs: 1 },
      { date: '2026-03-14', revenueCents: 0, newSubs: 0 },
      { date: '2026-03-15', revenueCents: 0, newSubs: 0 },
    ])
  })

  it('drops points outside the requested day range', () => {
    const days = ['2026-03-14']
    const result = bucketByLocalDay([makeTestOrder('2026-03-13T12:00:00.000Z', 999)], [], TZ, days)
    expect(result).toEqual([{ date: '2026-03-14', revenueCents: 0, newSubs: 0 }])
  })

  it('fills empty days with zeros', () => {
    const days = ['2026-03-13', '2026-03-14', '2026-03-15']
    const result = bucketByLocalDay([], [], TZ, days)
    expect(result).toEqual([
      { date: '2026-03-13', revenueCents: 0, newSubs: 0 },
      { date: '2026-03-14', revenueCents: 0, newSubs: 0 },
      { date: '2026-03-15', revenueCents: 0, newSubs: 0 },
    ])
  })
})
