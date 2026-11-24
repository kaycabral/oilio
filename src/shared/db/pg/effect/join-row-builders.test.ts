import type { CatalogItem, StoredMemberOperation, SubscriptionPlan } from '@/domain'
import { describe, expect, it } from 'vitest'
import { catalogItemUnitRows } from './catalog-item-projector'
import { memberOperationServiceRows, memberOperationUnitRows } from './member-operation-projector'
import {
  planIncludedCategoryRows,
  planIncludedItemRows,
  planUnitAllowlistRows,
} from './subscription-plan-projector'

describe('memberOperation join-row builders', () => {
  const base: StoredMemberOperation = {
    id: 'pro-1',
    orgId: 'org-1',
    userId: 'user-1',
    defaultCommission: null,
    unitIds: ['unit-1', 'unit-2'],
    catalogServiceIds: ['svc-1'],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  it('memberOperationUnitRows maps each unit to [org, pro, unit]', () => {
    expect(memberOperationUnitRows(base)).toEqual([
      ['org-1', 'pro-1', 'unit-1'],
      ['org-1', 'pro-1', 'unit-2'],
    ])
  })

  it('memberOperationServiceRows maps each service to [org, pro, service]', () => {
    expect(memberOperationServiceRows(base)).toEqual([['org-1', 'pro-1', 'svc-1']])
  })

  it('empty arrays produce zero rows (a shrunk membership leaves no orphans)', () => {
    const empty: StoredMemberOperation = { ...base, unitIds: [], catalogServiceIds: [] }
    expect(memberOperationUnitRows(empty)).toEqual([])
    expect(memberOperationServiceRows(empty)).toEqual([])
  })
})

describe('catalog-item join-row builder', () => {
  const item: CatalogItem = {
    id: 'cat-1',
    orgId: 'org-1',
    kind: 'service',
    name: 'Corte',
    categoryId: null,
    priceCents: 5000,
    commission: null,
    unitIds: ['unit-1', 'unit-2'],
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: 30,
    requiredResources: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  it('catalogItemUnitRows maps each unit to [org, item, unit]', () => {
    expect(catalogItemUnitRows(item)).toEqual([
      ['org-1', 'cat-1', 'unit-1'],
      ['org-1', 'cat-1', 'unit-2'],
    ])
  })

  it('an item with no unit scope produces zero rows', () => {
    expect(catalogItemUnitRows({ ...item, unitIds: [] })).toEqual([])
  })
})

describe('subscription-plan join-row builders', () => {
  const base: SubscriptionPlan = {
    id: 'plan-1',
    orgId: 'org-1',
    name: 'Mensal',
    description: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: ['item-1', 'item-2'],
    includedCategoryIds: ['cat-1'],
    usageLimit: { kind: 'unlimited' },
    unitAllowlist: ['unit-1'],
    active: true,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  it('planIncludedItemRows maps each item to [org, plan, item]', () => {
    expect(planIncludedItemRows(base)).toEqual([
      ['org-1', 'plan-1', 'item-1'],
      ['org-1', 'plan-1', 'item-2'],
    ])
  })

  it('planIncludedCategoryRows maps each category to [org, plan, category]', () => {
    expect(planIncludedCategoryRows(base)).toEqual([['org-1', 'plan-1', 'cat-1']])
  })

  it('planUnitAllowlistRows maps a present allowlist to [org, plan, unit]', () => {
    expect(planUnitAllowlistRows(base)).toEqual([['org-1', 'plan-1', 'unit-1']])
  })

  it('a null allowlist (no restriction) materializes ZERO rows', () => {
    expect(planUnitAllowlistRows({ ...base, unitAllowlist: null })).toEqual([])
  })

  it('empty included arrays produce zero rows', () => {
    const empty: SubscriptionPlan = { ...base, includedItemIds: [], includedCategoryIds: [] }
    expect(planIncludedItemRows(empty)).toEqual([])
    expect(planIncludedCategoryRows(empty)).toEqual([])
  })
})
