import type { CatalogItem, StoredProfessional, SubscriptionPlan } from '@/domain'
import { describe, expect, it } from 'vitest'
import { catalogItemUnitRows } from './catalog-item-projector'
import { professionalServiceRows, professionalUnitRows } from './professional-projector'
import {
  planIncludedCategoryRows,
  planIncludedItemRows,
  planUnitAllowlistRows,
} from './subscription-plan-projector'

// Pure-mapping coverage for the D3 join-row builders (brief 0068). These turn an
// aggregate's N:N arrays into `[org_id, owner_id, member_id]` tuples that the
// production projector AND the e2e seed both insert into the join tables — so
// pinning the tuple shape here keeps the runtime and the fixture in lockstep
// (the same lockstep the integration suite proves at the DB level). No I/O.

describe('professional join-row builders', () => {
  const base: StoredProfessional = {
    id: 'pro-1',
    orgId: 'org-1',
    userId: 'user-1',
    defaultCommission: null,
    unitIds: ['unit-1', 'unit-2'],
    catalogServiceIds: ['svc-1'],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  it('professionalUnitRows maps each unit to [org, pro, unit]', () => {
    expect(professionalUnitRows(base)).toEqual([
      ['org-1', 'pro-1', 'unit-1'],
      ['org-1', 'pro-1', 'unit-2'],
    ])
  })

  it('professionalServiceRows maps each service to [org, pro, service]', () => {
    expect(professionalServiceRows(base)).toEqual([['org-1', 'pro-1', 'svc-1']])
  })

  it('empty arrays produce zero rows (a shrunk membership leaves no orphans)', () => {
    const empty: StoredProfessional = { ...base, unitIds: [], catalogServiceIds: [] }
    expect(professionalUnitRows(empty)).toEqual([])
    expect(professionalServiceRows(empty)).toEqual([])
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
