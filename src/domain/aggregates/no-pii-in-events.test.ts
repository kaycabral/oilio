import { describe, expect, it } from 'vitest'

import type { OrderItem } from '@/domain/types/order'

import { INITIAL_AGENDA_BLOCK_STATE } from './agenda-block/types'
import { INITIAL_APPOINTMENT_STATE } from './appointment/types'
import { INITIAL_CASH_MOVEMENT_STATE } from './cash-movement/types'
import { INITIAL_CATALOG_ITEM_STATE } from './catalog-item/types'
import { INITIAL_CATEGORY_STATE } from './category/types'
import { INITIAL_CHARGE_STATE } from './charge/types'
import { INITIAL_COMMISSION_STATE } from './commission/types'
import { INITIAL_CUSTOMER_STATE } from './customer/types'
import { INITIAL_INVITE_STATE } from './invite/types'
import { INITIAL_MEMBER_OPERATION_STATE } from './member-operation/types'
import { INITIAL_MEMBERSHIP_STATE } from './membership/types'
import { INITIAL_NOTIFICATION_STATE } from './notification/types'
import { INITIAL_ORDER_STATE } from './order/types'
import { INITIAL_ORG_STATE } from './org/types'
import { INITIAL_SUBSCRIPTION_PLAN_STATE } from './subscription-plan/types'
import { INITIAL_SUBSCRIPTION_STATE } from './subscription/types'
import { INITIAL_UNIT_STATE } from './unit/types'

const SAMPLE_ORDER_ITEM = {
  id: '',
  kind: 'service',
  refId: '',
  name: '',
  quantity: 1,
  unitPriceCents: 0,
  commission: null,
  attributedUserId: '',
  coverage: 'sale',
  subscriptionId: null,
} satisfies OrderItem

const SNAPSHOTS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['order', INITIAL_ORDER_STATE],
  ['order-item', SAMPLE_ORDER_ITEM],
  ['commission', INITIAL_COMMISSION_STATE],
  ['charge', INITIAL_CHARGE_STATE],
  ['cash-movement', INITIAL_CASH_MOVEMENT_STATE],
  ['subscription', INITIAL_SUBSCRIPTION_STATE],
  ['appointment', INITIAL_APPOINTMENT_STATE],
  ['agenda-block', INITIAL_AGENDA_BLOCK_STATE],
  ['catalog-item', INITIAL_CATALOG_ITEM_STATE],
  ['category', INITIAL_CATEGORY_STATE],
  ['subscription-plan', INITIAL_SUBSCRIPTION_PLAN_STATE],
  ['member_operator', INITIAL_MEMBER_OPERATION_STATE],
  ['unit', INITIAL_UNIT_STATE],
  ['org', INITIAL_ORG_STATE],
  ['customer', INITIAL_CUSTOMER_STATE],
  ['membership', INITIAL_MEMBERSHIP_STATE],
  ['invite', INITIAL_INVITE_STATE],
  ['notification', INITIAL_NOTIFICATION_STATE],
]

const PII_TOKENS = [
  'name',
  'fullname',
  'firstname',
  'lastname',
  'displayname',
  'phone',
  'mobile',
  'email',
  'cpf',
  'cnpj',
  'taxid',
  'taxidentity',
  'birthdate',
  'birthday',
  'dateofbirth',
  'address',
  'street',
  'zipcode',
  'postalcode',
  'rg',
  'passport',
] as const

const ALLOWED_NAME_PATHS = new Set<string>([
  'unit.name',
  'org.name',
  'catalog-item.name',
  'category.name',
  'subscription-plan.name',
  'subscription.plan.name',
  'commission.itemName',
  'commission.attributedMemberName',
  'order-item.name',
])

const ALLOWED_NON_TITULAR_PII = new Set<string>([
  'unit.address::address',
  'unit.address.postalCode::postalcode',
  'unit.address.street::street',
])

function collectFieldPaths(value: unknown, prefix: string, out: string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (key === '_version') continue
    const path = prefix ? `${prefix}.${key}` : key
    out.push(path)
    collectFieldPaths(child, path, out)
  }
}

function fieldMatchesPiiToken(fieldName: string, token: string): boolean {
  const lower = fieldName.toLowerCase()
  if (lower === token) return true
  const segments = fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return segments.includes(token)
}

describe('AC-05 — zero PII in event snapshots/payloads (ADR 0010 invariant)', () => {
  it('enumerates every event-sourced aggregate (no aggregate silently skipped)', () => {
    expect(SNAPSHOTS.length).toBe(18)
    const labels = SNAPSHOTS.map(([label]) => label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  for (const [aggregate, snapshot] of SNAPSHOTS) {
    it(`${aggregate} snapshot carries no titular PII — identity by reference only`, () => {
      const paths: string[] = []
      collectFieldPaths(snapshot, aggregate, paths)

      const leaks: string[] = []
      for (const path of paths) {
        const fieldName = path.slice(path.lastIndexOf('.') + 1)
        for (const token of PII_TOKENS) {
          if (!fieldMatchesPiiToken(fieldName, token)) continue
          if (token === 'name' && ALLOWED_NAME_PATHS.has(path)) continue
          if (ALLOWED_NON_TITULAR_PII.has(`${path}::${token}`)) continue
          leaks.push(`${path} (matched PII token "${token}")`)
        }
      }

      expect(
        leaks,
        `PII leak in "${aggregate}" snapshot — move identity to a reference (id) ` +
          `and keep the value in a deletable _pii/global doc. Leaks:\n  ${leaks.join('\n  ')}`,
      ).toEqual([])
    })
  }

  it('the denylist actually fires (meta-test — guards a no-op gate)', () => {
    const poisoned = {
      id: '',
      customerId: 'ref-ok',
      attributedUserId: 'ref-ok',
      name: 'Fulano',
      contact: { mobile: '+55...', email: 'a@b.c' },
      taxIdentity: { taxId: '000' },
      birthDate: '1990-01-01',
    }
    const paths: string[] = []
    collectFieldPaths(poisoned, 'poisoned', paths)
    const matched = paths.filter((path) => {
      const fieldName = path.slice(path.lastIndexOf('.') + 1)
      return PII_TOKENS.some((token) => fieldMatchesPiiToken(fieldName, token))
    })
    expect(matched.sort()).toEqual(
      [
        'poisoned.birthDate',
        'poisoned.contact.email',
        'poisoned.contact.mobile',
        'poisoned.name',
        'poisoned.taxIdentity',
        'poisoned.taxIdentity.taxId',
      ].sort(),
    )
    expect(matched).not.toContain('poisoned.customerId')
    expect(matched).not.toContain('poisoned.attributedUserId')
  })
})
