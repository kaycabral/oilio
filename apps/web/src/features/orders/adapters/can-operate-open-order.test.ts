import { describe, expect, it } from 'vitest'

import {
  defaultPermissionsForRole,
  membershipDocId,
  type Membership,
  type OrderItem,
  type Role,
} from '@/domain'
import { canOperateOpenOrder, denyIfNotOwnOrder } from './order-write-helpers'

// Brief 0075 (#1257) — own-resource guard for OPEN-order edits. The balcão
// (owner/manager/recepção) operates any comanda; a self-scoped professional
// only one whose every item is attributed to them. Pure predicate — tested in
// isolation so the gate is proven independent of the action plumbing.

function membership(role: Role, userId = 'me'): Membership {
  return {
    id: membershipDocId('org1', userId),
    orgId: 'org1',
    userId,
    role,
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole(role),
  }
}

function item(attributedUserId: string): OrderItem {
  return {
    id: `item-${attributedUserId}`,
    kind: 'service',
    refId: 'svc1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 5000,
    commission: null,
    attributedUserId,
  }
}

describe('canOperateOpenOrder', () => {
  describe('balcão operates any comanda', () => {
    for (const role of ['owner', 'manager', 'receptionist'] as const) {
      it(`${role} edits an order full of a colleague's items`, () => {
        expect(canOperateOpenOrder(membership(role), [item('colleague')])).toBe(true)
      })
    }
  })

  describe('professional is own-scoped', () => {
    it('edits an order whose every item is theirs', () => {
      const m = membership('professional', 'me')
      expect(canOperateOpenOrder(m, [item('me'), item('me')])).toBe(true)
    })

    it("cannot edit an order with a colleague's item", () => {
      const m = membership('professional', 'me')
      expect(canOperateOpenOrder(m, [item('me'), item('colleague')])).toBe(false)
    })

    it("cannot edit an order made entirely of a colleague's items", () => {
      const m = membership('professional', 'me')
      expect(canOperateOpenOrder(m, [item('colleague')])).toBe(false)
    })

    it('can operate an order with no items yet (just opened → vacuously theirs)', () => {
      const m = membership('professional', 'me')
      expect(canOperateOpenOrder(m, [])).toBe(true)
    })
  })
})

describe('denyIfNotOwnOrder', () => {
  it('returns null when the member may operate', () => {
    expect(denyIfNotOwnOrder(membership('owner'), [item('colleague')])).toBeNull()
    expect(denyIfNotOwnOrder(membership('professional', 'me'), [item('me')])).toBeNull()
  })

  it("returns an error result when a professional touches a colleague's order", () => {
    const denied = denyIfNotOwnOrder(membership('professional', 'me'), [item('colleague')])
    expect(denied).toEqual({ ok: false, error: 'Você só pode editar comandas atribuídas a você' })
  })
})
