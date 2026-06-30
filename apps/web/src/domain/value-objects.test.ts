import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { NonEmptyString, NonNegativeInt } from './value-objects'

// The shared read-model invariants (#1283 / brief 0078 Group A + G). Both are
// CONSTRAINTS enforced at the schema decode (the event boundary), unbranded so
// `.Type` stays string/number — the DB CHECK is the second layer.
describe('NonEmptyString', () => {
  it('decodes a non-empty string', () => {
    expect(Schema.decodeUnknownSync(NonEmptyString)('abc')).toBe('abc')
  })

  it('rejects the empty string', () => {
    expect(() => Schema.decodeUnknownSync(NonEmptyString)('')).toThrow()
  })
})

describe('NonNegativeInt', () => {
  it('decodes zero and positive integers', () => {
    expect(Schema.decodeUnknownSync(NonNegativeInt)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(NonNegativeInt)(1500)).toBe(1500)
  })

  it('rejects a negative number', () => {
    expect(() => Schema.decodeUnknownSync(NonNegativeInt)(-1)).toThrow()
  })

  it('rejects a fractional number', () => {
    expect(() => Schema.decodeUnknownSync(NonNegativeInt)(10.5)).toThrow()
  })
})
