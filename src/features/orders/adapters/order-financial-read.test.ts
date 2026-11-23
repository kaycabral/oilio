import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readUnderRls: vi.fn() }))
vi.mock('@/shared/db/pg/rls-read', () => ({ readUnderRls: mocks.readUnderRls }))

import {
  loadActiveSubscriptionId,
  loadCommissionsForOrder,
  loadOpenOrdersForOrg,
  loadOrderById,
  loadSaleMovementForOrder,
} from './order-financial-read'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('order-financial-read — RLS-typed rows', () => {
  const ORDER_ROW = {
    org_id: 'org-1',
    id: 'o1',
    unit_id: 'u1',
    version: 1,
    customer_id: 'c1',
    appointment_id: null,
    status: 'open',
    closed_at: null,
    payment_method: null,
    discount_cents: 0,
    subtotal_cents: 0,
    total_cents: 0,
    items: [],
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  }
  const COMMISSION_ROW = {
    org_id: 'org-1',
    id: 'com-1',
    version: 1,
    order_id: 'o1',
    order_item_id: 'it-1',
    attributed_user_id: 'u1',
    attributed_member_name: 'Zé',
    item_kind: 'service',
    item_name: 'Corte',
    item_total_cents: 5000,
    commission_kind: 'percentage',
    commission_value: 50,
    amount_cents: 2500,
    liquidation_status: 'pendente',
    paid_at: null,
    payment_proof: null,
    created_at: '2026-06-01T12:00:00.000Z',
  }
  const SALE_ROW = {
    org_id: 'org-1',
    id: 'm1',
    unit_id: 'u1',
    version: 1,
    kind: 'sale',
    direction: 'in',
    amount_cents: 5000,
    payment_method: 'pix',
    order_id: 'o1',
    expense_category_id: null,
    description: null,
    recorded_by_uid: 'u1',
    created_at: '2026-06-01T12:00:00.000Z',
  }

  it('loadOrderById reads the typed orders row', async () => {
    mocks.readUnderRls.mockResolvedValue([ORDER_ROW])
    expect(await loadOrderById('org-1', 'o1')).toMatchObject({ id: 'o1', status: 'open' })
    mocks.readUnderRls.mockResolvedValue([])
    expect(await loadOrderById('org-1', 'o1')).toBeNull()
  })

  it('loadOpenOrdersForOrg + loadCommissionsForOrder map typed rows', async () => {
    mocks.readUnderRls.mockResolvedValue([ORDER_ROW])
    expect(await loadOpenOrdersForOrg('org-1')).toHaveLength(1)
    mocks.readUnderRls.mockResolvedValue([COMMISSION_ROW])
    expect(await loadCommissionsForOrder('org-1', 'o1')).toHaveLength(1)
  })

  it('loadSaleMovementForOrder + loadActiveSubscriptionId read typed rows', async () => {
    mocks.readUnderRls.mockResolvedValue([SALE_ROW])
    expect(await loadSaleMovementForOrder('org-1', 'o1')).toMatchObject({ kind: 'sale' })
    mocks.readUnderRls.mockResolvedValue([])
    expect(await loadSaleMovementForOrder('org-1', 'o1')).toBeNull()

    mocks.readUnderRls.mockResolvedValue([{ id: 'sub-9' }])
    expect(await loadActiveSubscriptionId('org-1', 'c1')).toBe('sub-9')
    mocks.readUnderRls.mockResolvedValue([])
    expect(await loadActiveSubscriptionId('org-1', 'c1')).toBeNull()
  })
})
