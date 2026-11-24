import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { LedgerEntry } from './ledger'

const decode = Schema.decodeUnknownSync(LedgerEntry)

const valid = {
  id: 'order:ord1:it1',
  orgId: 't1',
  unitId: 'unit1',
  nature: 'revenue',
  behavior: 'variable',
  link: 'item',
  amountCents: 5000,
  direction: 'in',
  source: 'order',
  sourceId: 'ord1',
  itemId: 'it1',
  occurredAt: '2026-07-01T13:00:00.000Z',
} as const

describe('LedgerEntry schema', () => {
  it('decodes a well-formed entry', () => {
    expect(decode(valid)).toMatchObject({ nature: 'revenue', amountCents: 5000 })
  })

  it('rejects a negative amount (Money brand: positive cents, sign lives in direction)', () => {
    expect(() => decode({ ...valid, amountCents: -1 })).toThrow()
  })

  it('rejects an unknown nature outside the canonical set', () => {
    expect(() => decode({ ...valid, nature: 'profit' })).toThrow()
  })

  it('accepts a null itemId for sale-linked facts (charge)', () => {
    expect(() => decode({ ...valid, link: 'sale', itemId: null })).not.toThrow()
  })
})
