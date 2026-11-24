import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { OrderItem } from './order'

describe('OrderItem non-empty invariant (#1283 Group E)', () => {
  const VALID = {
    id: 'item-1',
    kind: 'service' as const,
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 5000,
    commission: null,
    attributedUserId: 'user-1',
  }

  it('decodes a valid OrderItem', () => {
    const decoded = Schema.decodeUnknownSync(OrderItem)(VALID)
    expect(decoded.name).toBe('Corte')
  })

  it.each(['id', 'refId', 'name', 'attributedUserId'] as const)('rejects an empty %s', (field) => {
    expect(() => Schema.decodeUnknownSync(OrderItem)({ ...VALID, [field]: '' })).toThrow()
  })

  it('rejects a negative unitPriceCents', () => {
    expect(() => Schema.decodeUnknownSync(OrderItem)({ ...VALID, unitPriceCents: -1 })).toThrow()
  })
})
