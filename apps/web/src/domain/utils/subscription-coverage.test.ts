import { describe, expect, it } from 'vitest'
import {
  isItemCoveredBySubscription,
  isItemCoveredWithBalance,
  type SubscriptionCoverageEntry,
} from './subscription-coverage'

// Brief 0024, Grupo B (AC-04). The consumption-time resolver: item ∈
// includedItemIds (direct) OR item.categoryId ∈ includedCategoryIds (category
// convenience expansion). Kind-agnostic — service and product resolve the same.
const snapshot = (includedItemIds: string[], includedCategoryIds: string[]) => ({
  includedItemIds,
  includedCategoryIds,
})

describe('isItemCoveredBySubscription', () => {
  it('covers an item directly listed in includedItemIds', () => {
    const snap = snapshot(['item-barba'], [])
    expect(isItemCoveredBySubscription(snap, { id: 'item-barba', categoryId: 'cat-x' })).toBe(true)
  })

  it('covers an item whose category is in includedCategoryIds (convenience)', () => {
    const snap = snapshot([], ['cat-cabelo'])
    expect(isItemCoveredBySubscription(snap, { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(
      true,
    )
  })

  it('does NOT cover an item neither listed nor in a covered category', () => {
    const snap = snapshot(['item-barba'], ['cat-cabelo'])
    expect(
      isItemCoveredBySubscription(snap, { id: 'item-pomada', categoryId: 'cat-produtos' }),
    ).toBe(false)
  })

  it('does NOT cover an uncategorized item via category expansion', () => {
    const snap = snapshot([], ['cat-cabelo'])
    expect(isItemCoveredBySubscription(snap, { id: 'item-x', categoryId: null })).toBe(false)
  })

  it('covers an uncategorized item when directly listed', () => {
    const snap = snapshot(['item-x'], [])
    expect(isItemCoveredBySubscription(snap, { id: 'item-x', categoryId: null })).toBe(true)
  })

  it('is kind-agnostic — resolves a product (id match) identically to a service', () => {
    const snap = snapshot(['prod-pomada'], [])
    expect(
      isItemCoveredBySubscription(snap, { id: 'prod-pomada', categoryId: 'cat-produtos' }),
    ).toBe(true)
  })

  it('direct item match wins even when the category is not covered', () => {
    const snap = snapshot(['item-barba'], ['cat-cabelo'])
    expect(isItemCoveredBySubscription(snap, { id: 'item-barba', categoryId: 'cat-x' })).toBe(true)
  })

  it('an empty snapshot is unrestricted — covers everything (most permissive wins)', () => {
    // Both lists empty = no item/category restriction; mirrors the booking path
    // where empty `includedCategoryIds` collapses to "no restriction".
    const snap = snapshot([], [])
    expect(isItemCoveredBySubscription(snap, { id: 'item-barba', categoryId: 'cat-x' })).toBe(true)
    expect(isItemCoveredBySubscription(snap, { id: 'x', categoryId: null })).toBe(true)
  })
})

// Brief 0079, Grupo A (AC-01/AC-02). Recognition predicate: an item is "covered
// with balance" when SOME scope-bearing subscription both covers it and still
// has cycle balance. Decides badge/auto-mark presence; the balance count itself
// never reaches the UI (asserted by the resolver returning `remaining` only).
const entry = (
  includedItemIds: string[],
  includedCategoryIds: string[],
  remaining: number | null,
): SubscriptionCoverageEntry => ({ includedItemIds, includedCategoryIds, remaining })

describe('isItemCoveredWithBalance', () => {
  it('is true when a covering subscription has positive balance', () => {
    const entries = [entry(['item-corte'], [], 2)]
    expect(isItemCoveredWithBalance(entries, { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(
      true,
    )
  })

  it('is true for an unlimited covering subscription (remaining null)', () => {
    const entries = [entry([], ['cat-cabelo'], null)]
    expect(isItemCoveredWithBalance(entries, { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(
      true,
    )
  })

  it('is false when the only covering subscription is out of balance (→ avulso)', () => {
    // AC-04: covered but no balance → falls back to full price, no badge.
    const entries = [entry(['item-corte'], [], 0)]
    expect(isItemCoveredWithBalance(entries, { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(
      false,
    )
  })

  it('is false when no subscription covers the item, even with balance', () => {
    const entries = [entry(['item-barba'], [], 5)]
    expect(isItemCoveredWithBalance(entries, { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(
      false,
    )
  })

  it('is false with no scope-bearing subscription at all', () => {
    expect(isItemCoveredWithBalance([], { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(false)
  })

  it('picks the subscription with balance when another covers but is exhausted', () => {
    // One plan covers Corte but is out of balance; another (unlimited) also
    // covers it — the item keeps the badge via the second.
    const entries = [entry(['item-corte'], [], 0), entry([], ['cat-cabelo'], null)]
    expect(isItemCoveredWithBalance(entries, { id: 'item-corte', categoryId: 'cat-cabelo' })).toBe(
      true,
    )
  })

  it('is kind-agnostic — a covered product with balance qualifies', () => {
    const entries = [entry(['prod-pomada'], [], 1)]
    expect(
      isItemCoveredWithBalance(entries, { id: 'prod-pomada', categoryId: 'cat-produtos' }),
    ).toBe(true)
  })
})
