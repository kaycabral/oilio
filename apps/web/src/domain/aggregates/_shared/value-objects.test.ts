import { Either } from 'effect'
import { describe, expect, it } from 'vitest'

import { AggregateVersion, Money, OrgId } from './value-objects'

describe('Money', () => {
  it('AC-09: accepts non-negative integer', () => {
    expect(Money(1000)).toBe(1000)
    expect(Money(0)).toBe(0)
  })

  it('AC-09: rejects negative value', () => {
    expect(Either.isLeft(Money.either(-1))).toBe(true)
  })

  it('AC-09: rejects non-integer', () => {
    expect(Either.isLeft(Money.either(10.5))).toBe(true)
  })
})

describe('OrgId', () => {
  it('AC-09: accepts non-empty string', () => {
    expect(OrgId('t-123')).toBe('t-123')
  })

  it('AC-09: rejects empty string', () => {
    expect(Either.isLeft(OrgId.either(''))).toBe(true)
  })
})

describe('AggregateVersion', () => {
  it('accepts non-negative integer', () => {
    expect(AggregateVersion(0)).toBe(0)
    expect(AggregateVersion(42)).toBe(42)
  })

  it('rejects negative', () => {
    expect(Either.isLeft(AggregateVersion.either(-1))).toBe(true)
  })

  it('rejects float', () => {
    expect(Either.isLeft(AggregateVersion.either(1.5))).toBe(true)
  })
})
