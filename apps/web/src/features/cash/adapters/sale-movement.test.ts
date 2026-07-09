import { describe, expect, it } from 'vitest'
import { buildSaleMovement } from './sale-movement'

describe('buildSaleMovement', () => {
  const params = {
    orgId: 't1',
    unitId: 'u1',
    orderId: 'o1',
    amountCents: 5000,
    paymentMethod: 'pix' as const,
    actorUid: 'actor-1',
  }

  it('builds a `sale` movement that is money IN, linked to the order', () => {
    const m = buildSaleMovement(params)
    expect(m.kind).toBe('sale')
    expect(m.direction).toBe('in')
    expect(m.orderId).toBe('o1')
    expect(m.amountCents).toBe(5000)
    expect(m.paymentMethod).toBe('pix')
    expect(m.recordedByUid).toBe('actor-1')
    expect(m.orgId).toBe('t1')
    expect(m.unitId).toBe('u1')
    expect(m.expenseCategoryId).toBeNull()
    expect(m.description).toBeNull()
  })

  it('mints a fresh id and an ISO timestamp on each build', () => {
    const a = buildSaleMovement(params)
    const b = buildSaleMovement(params)
    expect(a.id).not.toBe(b.id)
    expect(() => new Date(a.createdAt).toISOString()).not.toThrow()
    expect(new Date(a.createdAt).toISOString()).toBe(a.createdAt)
  })
})
