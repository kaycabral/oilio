import { describe, expect, it } from 'vitest'
import { isItemCoveredBySubscription } from './subscription-coverage'

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
