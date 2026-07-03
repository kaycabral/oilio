import { CustomerConfig } from '@/domain/aggregates/customer/config'
import { GoalConfig } from '@/domain/aggregates/goal/config'
import { InviteConfig } from '@/domain/aggregates/invite/config'
import { NotificationConfig } from '@/domain/aggregates/notification/config'
import type { NotificationState } from '@/domain/aggregates/notification/types'
import { aggregateRef, type FirestoreDoc } from '@/domain/effect'
import type { AgendaBlock } from '@/domain/types/agenda-block'
import type { Category } from '@/domain/types/category'
import type { Customer } from '@/domain/types/customer'
import type { Goal } from '@/domain/types/goal'
import type { Invite } from '@/domain/types/invite'
import type { MemberOperation } from '@/domain/types/member-operation'
import type { SubscriptionPlan } from '@/domain/types/subscription-plan'
import { describe, expect, it } from 'vitest'
import {
  AGENDA_BLOCK_COLUMNS,
  agendaBlockColumnValues,
  rowToDoc as agendaBlockRowToDoc,
  type AgendaBlockRow,
} from './agenda-block-projector'
import {
  CATEGORY_COLUMNS,
  categoryColumnValues,
  rowToDoc as categoryRowToDoc,
  type CategoryRow,
} from './category-projector'
import {
  CUSTOMER_COLUMNS,
  customerColumnValues,
  rowToDoc as customerRowToDoc,
  type CustomerRow,
} from './customer-projector'
import {
  GOAL_COLUMNS,
  goalColumnValues,
  rowToDoc as goalRowToDoc,
  type GoalRow,
} from './goal-projector'
import {
  INVITE_COLUMNS,
  inviteColumnValues,
  rowToDoc as inviteRowToDoc,
  type InviteRow,
} from './invite-projector'
import {
  MEMBER_OPERATION_COLUMNS,
  memberOperationColumnValues,
  rowToDoc as memberOperationRowToDoc,
  type MemberOperationRow,
} from './member-operation-projector'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
  rowToDoc as notificationRowToDoc,
  type NotificationRow,
} from './notification-projector'
import {
  SUBSCRIPTION_PLAN_COLUMNS,
  subscriptionPlanColumnValues,
  rowToDoc as subscriptionPlanRowToDoc,
  type SubscriptionPlanRow,
} from './subscription-plan-projector'

/**
 * Pure-mapping unit tests for the config typed projectors (brief 0060, Feature
 * D). Mirror `identity-projectors.test.ts`: exercise `*ColumnValues` (domain →
 * ordered SQL row) and `rowToDoc` (row → reducer doc) WITHOUT a database — the
 * runtime upsert + the E2E seed both go through `*ColumnValues`, so this pins the
 * column count/order and the round-trip shape. The DB-level routing/constraints
 * are proven by `config-projection.events.pg.integration.test.ts`.
 *
 * The key invariant: a row built from `*ColumnValues`, read back as a `*Row`, and
 * passed through `rowToDoc` reconstructs the domain fields — the lockstep that
 * keeps the seed and the runtime projector from drifting.
 */

// Pull a column's value out of the ordered `*ColumnValues` array by its name in
// the matching `*COLUMNS` list — builds a typed `*Row` literal from the
// column-values output without a dynamic-keyed cast. JSONB array columns come
// back from pg parsed, so `at(col)` (the stringified value) is re-parsed for
// those; bigint columns come back as strings (modeled by asPgBigint).
function valueAt(columns: readonly string[], values: readonly unknown[], col: string): unknown {
  return values[columns.indexOf(col)]
}
function asPgBigint(v: unknown): string {
  return String(v)
}
// JSONB array columns are `JSON.stringify`'d by `*ColumnValues`; the pg driver
// hands them back parsed. Re-parse the stringified value to model the row.
function asPgJsonb(v: unknown): unknown {
  return typeof v === 'string' ? JSON.parse(v) : v
}

describe('memberOperation projector — pure mapping', () => {
  const memberOperation: MemberOperation = {
    id: 'pro-1',
    orgId: 'org-1',
    userId: 'user-1',
    name: 'Zé',
    mobile: '5511999999999',
    email: 'ze@x.com',
    taxIdentity: null,
    operationalStatus: 'operational',
    defaultCommission: { kind: 'percentage', value: 50 },
    unitIds: ['unit-1', 'unit-2'],
    catalogServiceIds: ['svc-1'],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function memberOperationRow(version: number): MemberOperationRow {
    const v = memberOperationColumnValues(memberOperation, version)
    const at = (c: string): unknown => valueAt(MEMBER_OPERATION_COLUMNS, v, c)
    return {
      org_id: memberOperation.orgId,
      id: memberOperation.id,
      last_event_version: asPgBigint(at('last_event_version')),
      user_id: memberOperation.userId,
      // Derived membership key (`{orgId}_{userId}`) — same value the projector
      // writes into `member_id`.
      member_id: `${memberOperation.orgId}_${memberOperation.userId}`,
      default_commission: at('default_commission'),
      unit_ids: asPgJsonb(at('unit_ids')),
      catalog_service_ids: asPgJsonb(at('catalog_service_ids')),
      created_at: memberOperation.createdAt,
      updated_at: memberOperation.updatedAt,
    }
  }

  it('columnValues has one value per column; PII is NOT projected', () => {
    const v = memberOperationColumnValues(memberOperation, 1)
    expect(v).toHaveLength(MEMBER_OPERATION_COLUMNS.length)
    expect(v[MEMBER_OPERATION_COLUMNS.indexOf('user_id')]).toBe('user-1')
    // name/mobile/email never reach the typed table (LGPD — sidecar/users).
    expect(v).not.toContain('Zé')
    expect(v).not.toContain('ze@x.com')
  })

  it('rowToDoc round-trips the operational fields (+ _version)', () => {
    const doc = memberOperationRowToDoc(memberOperationRow(2))
    expect(doc).toMatchObject({
      _version: 2,
      id: 'pro-1',
      userId: 'user-1',
      unitIds: ['unit-1', 'unit-2'],
      catalogServiceIds: ['svc-1'],
    })
    // operationalStatus is derived on read (#1226 AC-02), never stored/round-tripped.
    expect('operationalStatus' in doc).toBe(false)
  })
})

describe('customer projector — pure mapping', () => {
  const customer: Customer = {
    id: 'cust-1',
    orgId: 'org-1',
    userId: 'user-9',
    name: 'Maria',
    mobile: '5511988888888',
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function customerRow(version: number, overrides: Partial<CustomerRow> = {}): CustomerRow {
    const v = customerColumnValues(
      customer,
      aggregateRef(CustomerConfig, customer.orgId, customer.id),
      version,
    )
    const at = (c: string): unknown => valueAt(CUSTOMER_COLUMNS, v, c)
    return {
      org_id: customer.orgId,
      id: customer.id,
      last_event_version: asPgBigint(at('last_event_version')),
      user_id: customer.userId,
      archived_at: customer.archivedAt,
      deactivated_at: customer.deactivatedAt,
      acquisition: customer.acquisition,
      created_at: customer.createdAt,
      updated_at: customer.updatedAt,
      ...overrides,
    }
  }

  it('columnValues has one value per column; only operational fields, no PII', () => {
    const v = customerColumnValues(
      customer,
      aggregateRef(CustomerConfig, customer.orgId, customer.id),
      1,
    )
    expect(v).toHaveLength(CUSTOMER_COLUMNS.length)
    expect(v[CUSTOMER_COLUMNS.indexOf('user_id')]).toBe('user-9')
    expect(v).not.toContain('Maria')
  })

  it('rowToDoc round-trips userId + the two non-active markers', () => {
    const doc = customerRowToDoc(
      customerRow(3, { archived_at: '2026-06-02T00:00:00.000Z', deactivated_at: null }),
    )
    expect(doc).toMatchObject({
      _version: 3,
      id: 'cust-1',
      userId: 'user-9',
      archivedAt: '2026-06-02T00:00:00.000Z',
      deactivatedAt: null,
    })
  })
})

describe('invite projector — pure mapping', () => {
  const pendingInvite: Invite = {
    id: 'inv-1',
    orgId: 'org-1',
    mobile: '5511990000001',
    role: 'member_operator',
    tokenHash: 'hash-abc',
    expiresAt: '2026-06-08T00:00:00.000Z',
    status: 'pending',
    invitedBy: 'owner-1',
    acceptedByUid: null,
    acceptedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function inviteRow(inv: Invite, version: number): InviteRow {
    const v = inviteColumnValues(inv, aggregateRef(InviteConfig, inv.orgId, inv.id), version)
    const at = (c: string): unknown => valueAt(INVITE_COLUMNS, v, c)
    return {
      org_id: inv.orgId,
      id: inv.id,
      last_event_version: asPgBigint(at('last_event_version')),
      role: inv.role,
      token_hash: inv.tokenHash,
      expires_at: inv.expiresAt,
      status: inv.status,
      invited_by: inv.invitedBy,
      accepted_by_uid: inv.acceptedByUid,
      accepted_at: inv.acceptedAt,
      created_at: inv.createdAt,
      updated_at: inv.updatedAt,
    }
  }

  it('columnValues has one value per column; email (PII) is NOT projected', () => {
    const v = inviteColumnValues(
      pendingInvite,
      aggregateRef(InviteConfig, pendingInvite.orgId, pendingInvite.id),
      1,
    )
    expect(v).toHaveLength(INVITE_COLUMNS.length)
    expect(v[INVITE_COLUMNS.indexOf('status')]).toBe('pending')
    expect(v[INVITE_COLUMNS.indexOf('role')]).toBe('member_operator')
    expect(v).not.toContain('invitee@x.com')
  })

  it('rowToDoc round-trips a pending invite (no acceptance fields)', () => {
    const doc = inviteRowToDoc(inviteRow(pendingInvite, 1))
    expect(doc).toMatchObject({
      _version: 1,
      id: 'inv-1',
      role: 'member_operator',
      status: 'pending',
      acceptedByUid: null,
      acceptedAt: null,
    })
  })

  it('rowToDoc round-trips an accepted invite (who/when present)', () => {
    const accepted: Invite = {
      ...pendingInvite,
      status: 'accepted',
      acceptedByUid: 'uid-7',
      acceptedAt: '2026-06-02T10:00:00.000Z',
    }
    const doc = inviteRowToDoc(inviteRow(accepted, 2))
    expect(doc).toMatchObject({
      status: 'accepted',
      acceptedByUid: 'uid-7',
      acceptedAt: '2026-06-02T10:00:00.000Z',
    })
  })
})

describe('category projector — pure mapping', () => {
  const category: Category = {
    id: 'cat-1',
    orgId: 'org-1',
    name: 'Cabelo',
    icon: 'scissors',
    color: '#abc',
    active: true,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function categoryRow(version: number): CategoryRow {
    const v = categoryColumnValues(category, version)
    const at = (c: string): unknown => valueAt(CATEGORY_COLUMNS, v, c)
    return {
      org_id: category.orgId,
      id: category.id,
      last_event_version: asPgBigint(at('last_event_version')),
      name: category.name,
      icon: category.icon,
      color: category.color,
      active: category.active,
      archived_at: category.archivedAt,
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    }
  }

  it('columnValues has one value per column', () => {
    const v = categoryColumnValues(category, 1)
    expect(v).toHaveLength(CATEGORY_COLUMNS.length)
    expect(v[CATEGORY_COLUMNS.indexOf('name')]).toBe('Cabelo')
    expect(v[CATEGORY_COLUMNS.indexOf('active')]).toBe(true)
  })

  it('rowToDoc round-trips the category fields (+ _version)', () => {
    const doc = categoryRowToDoc(categoryRow(5))
    expect(doc).toMatchObject({
      _version: 5,
      id: 'cat-1',
      name: 'Cabelo',
      icon: 'scissors',
      color: '#abc',
      active: true,
      archivedAt: null,
    })
  })
})

describe('subscription-plan projector — pure mapping', () => {
  const base: SubscriptionPlan = {
    id: 'plan-1',
    orgId: 'org-1',
    name: 'Mensal',
    description: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: ['item-1'],
    includedCategoryIds: ['cat-1'],
    usageLimit: { kind: 'unlimited' },
    active: true,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function planRow(plan: SubscriptionPlan, version: number): SubscriptionPlanRow {
    const v = subscriptionPlanColumnValues(plan, version)
    const at = (c: string): unknown => valueAt(SUBSCRIPTION_PLAN_COLUMNS, v, c)
    return {
      org_id: plan.orgId,
      id: plan.id,
      last_event_version: asPgBigint(at('last_event_version')),
      name: plan.name,
      description: plan.description,
      price_cents: asPgBigint(at('price_cents')),
      billing_cycle: plan.billingCycle,
      active: plan.active,
      archived_at: plan.archivedAt,
      usage_limit_kind: plan.usageLimit.kind,
      usage_limit: at('usage_limit'),
      included_item_ids: asPgJsonb(at('included_item_ids')),
      included_category_ids: asPgJsonb(at('included_category_ids')),
      unit_allowlist: at('unit_allowlist') === null ? null : asPgJsonb(at('unit_allowlist')),
      allowed_time_scope: at('allowed_time_scope'),
      booking_limits: at('booking_limits'),
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
    }
  }

  it('lifts the usageLimit discriminant to a column (unlimited)', () => {
    const v = subscriptionPlanColumnValues(base, 1)
    expect(v).toHaveLength(SUBSCRIPTION_PLAN_COLUMNS.length)
    expect(v[SUBSCRIPTION_PLAN_COLUMNS.indexOf('usage_limit_kind')]).toBe('unlimited')
    // optional scope rules collapse to NULL when absent
    expect(v[SUBSCRIPTION_PLAN_COLUMNS.indexOf('unit_allowlist')]).toBeNull()
    expect(v[SUBSCRIPTION_PLAN_COLUMNS.indexOf('allowed_time_scope')]).toBeNull()
    expect(v[SUBSCRIPTION_PLAN_COLUMNS.indexOf('booking_limits')]).toBeNull()
  })

  it('rowToDoc round-trips an unlimited plan; absent scope rules stay absent', () => {
    const doc = subscriptionPlanRowToDoc(planRow(base, 1))
    expect(doc).toMatchObject({
      _version: 1,
      id: 'plan-1',
      priceCents: 9900,
      billingCycle: 'monthly',
      usageLimit: { kind: 'unlimited' },
      includedItemIds: ['item-1'],
    })
    expect('unitAllowlist' in doc).toBe(false)
    expect('allowedTimeScope' in doc).toBe(false)
    expect('bookingLimits' in doc).toBe(false)
  })

  it('round-trips a count usageLimit (union body in JSONB) + present scope rules', () => {
    const counted: SubscriptionPlan = {
      ...base,
      usageLimit: { kind: 'count', quantity: 4 },
      unitAllowlist: ['unit-1'],
      allowedTimeScope: { daysOfWeek: [1, 2, 3] },
      bookingLimits: { maxPerDay: 1 },
    }
    const v = subscriptionPlanColumnValues(counted, 1)
    expect(v[SUBSCRIPTION_PLAN_COLUMNS.indexOf('usage_limit_kind')]).toBe('count')
    const doc = subscriptionPlanRowToDoc(planRow(counted, 2))
    expect(doc).toMatchObject({
      _version: 2,
      usageLimit: { kind: 'count', quantity: 4 },
      unitAllowlist: ['unit-1'],
      allowedTimeScope: { daysOfWeek: [1, 2, 3] },
      bookingLimits: { maxPerDay: 1 },
    })
  })
})

describe('agenda-block projector — pure mapping', () => {
  const recurring: AgendaBlock = {
    id: 'blk-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    memberOperationId: 'pro-1',
    reason: 'Almoço',
    kind: 'recurring',
    weekday: 'monday',
    open: '12:00',
    close: '13:00',
    startAt: null,
    endAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
  const oneOff: AgendaBlock = {
    id: 'blk-2',
    orgId: 'org-1',
    unitId: 'unit-1',
    memberOperationId: null,
    reason: 'Feriado',
    kind: 'one_off',
    weekday: null,
    open: null,
    close: null,
    startAt: '2026-06-20T14:00:00.000Z',
    endAt: '2026-06-20T18:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function blockRow(block: AgendaBlock, version: number): AgendaBlockRow {
    const v = agendaBlockColumnValues(block, version)
    const at = (c: string): unknown => valueAt(AGENDA_BLOCK_COLUMNS, v, c)
    // The `block` JSONB body the projector emitted is the same shape the pg
    // driver hands back; reconstruct it from the domain fields (the body is what
    // `agendaBlockColumnValues` packs) so the row is lockstep with columnValues.
    const body: AgendaBlockRow['block'] = {
      reason: block.reason,
      weekday: block.weekday,
      open: block.open,
      close: block.close,
      startAt: block.startAt,
      endAt: block.endAt,
    }
    return {
      org_id: block.orgId,
      id: block.id,
      unit_id: block.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      kind: block.kind,
      member_operation_id: block.memberOperationId,
      block: body,
      created_at: block.createdAt,
      updated_at: block.updatedAt,
    }
  }

  it('lifts kind + unit_id + member_operation_id to columns; body rides JSONB', () => {
    const v = agendaBlockColumnValues(recurring, 1)
    expect(v).toHaveLength(AGENDA_BLOCK_COLUMNS.length)
    expect(v[AGENDA_BLOCK_COLUMNS.indexOf('kind')]).toBe('recurring')
    expect(v[AGENDA_BLOCK_COLUMNS.indexOf('unit_id')]).toBe('unit-1')
    expect(v[AGENDA_BLOCK_COLUMNS.indexOf('member_operation_id')]).toBe('pro-1')
  })

  it('rowToDoc round-trips a recurring block (weekday/open/close)', () => {
    const doc = agendaBlockRowToDoc(blockRow(recurring, 1))
    expect(doc).toMatchObject({
      _version: 1,
      id: 'blk-1',
      kind: 'recurring',
      weekday: 'monday',
      open: '12:00',
      close: '13:00',
      startAt: null,
      endAt: null,
      memberOperationId: 'pro-1',
    })
  })

  it('rowToDoc round-trips a one_off block (startAt/endAt; whole-unit)', () => {
    const doc = agendaBlockRowToDoc(blockRow(oneOff, 2))
    expect(doc).toMatchObject({
      _version: 2,
      id: 'blk-2',
      kind: 'one_off',
      weekday: null,
      startAt: '2026-06-20T14:00:00.000Z',
      endAt: '2026-06-20T18:00:00.000Z',
      memberOperationId: null,
    })
  })
})

describe('goal projector — pure mapping', () => {
  const goal: Goal = {
    id: 'profit__unit-1__2026-06',
    orgId: 'org-1',
    unitId: 'unit-1',
    period: '2026-06',
    type: 'profit',
    targetCents: 500000,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function goalRow(version: number): GoalRow {
    const v = goalColumnValues(goal, aggregateRef(GoalConfig, goal.orgId, goal.id), version)
    const at = (c: string): unknown => valueAt(GOAL_COLUMNS, v, c)
    return {
      org_id: goal.orgId,
      id: goal.id,
      unit_id: goal.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      period: goal.period,
      type: goal.type,
      target_cents: asPgBigint(at('target_cents')),
      created_at: goal.createdAt,
      updated_at: goal.updatedAt,
    }
  }

  it('columnValues has one value per column', () => {
    const v = goalColumnValues(goal, aggregateRef(GoalConfig, goal.orgId, goal.id), 1)
    expect(v).toHaveLength(GOAL_COLUMNS.length)
    expect(v[GOAL_COLUMNS.indexOf('type')]).toBe('profit')
    expect(v[GOAL_COLUMNS.indexOf('period')]).toBe('2026-06')
  })

  it('rowToDoc round-trips the goal (target coerced from bigint string)', () => {
    const doc = goalRowToDoc(goalRow(3))
    expect(doc).toMatchObject({
      _version: 3,
      id: 'profit__unit-1__2026-06',
      unitId: 'unit-1',
      period: '2026-06',
      type: 'profit',
      targetCents: 500000,
    })
  })
})

describe('notification projector — pure mapping', () => {
  const base: NotificationState = {
    id: 'ntf-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    type: 'birthday',
    customerId: 'cust-1',
    appointmentId: null,
    subscriptionId: null,
    payload: { servico: 'Corte' },
    source: 'cron',
    eventKey: 'birthday-cust-1-2026-06',
    createdAt: '2026-06-01T00:00:00.000Z',
    readAt: null,
    dispatchedAt: null,
    dispatchedChannel: null,
    dispatchedBody: null,
    validUntil: null,
    snoozedUntil: null,
    _version: 1,
  }

  // `notificationColumnValues` takes the reduced FirestoreDoc (it decodes via the
  // NotificationState schema internally), so pass the state as a plain doc.
  const asDoc = (n: NotificationState): FirestoreDoc => ({ ...n })

  function notificationRow(n: NotificationState): NotificationRow {
    const v = notificationColumnValues(
      asDoc(n),
      aggregateRef(NotificationConfig, n.orgId, n.id),
      n._version,
    )
    const at = (c: string): unknown => valueAt(NOTIFICATION_COLUMNS, v, c)
    // The dispatch snapshot the projector packs: null while not dispatched, else
    // the channel/body pair. Reconstruct from the source so the row is lockstep
    // with columnValues without an unsafe assertion on the `unknown` JSONB value.
    const dispatch: NotificationRow['dispatch'] =
      n.dispatchedChannel === null && n.dispatchedBody === null
        ? null
        : { dispatchedChannel: n.dispatchedChannel, dispatchedBody: n.dispatchedBody }
    return {
      org_id: n.orgId,
      id: n.id,
      unit_id: n.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      type: n.type,
      source: n.source,
      event_key: n.eventKey,
      customer_id: n.customerId,
      appointment_id: n.appointmentId,
      subscription_id: n.subscriptionId,
      read_at: n.readAt,
      dispatched_at: n.dispatchedAt,
      valid_until: n.validUntil,
      snoozed_until: n.snoozedUntil,
      payload: n.payload,
      dispatch,
      created_at: n.createdAt,
      updated_at: n.createdAt,
    }
  }

  it('columnValues lifts type/source to columns; dispatch JSONB is NULL when not dispatched', () => {
    const v = notificationColumnValues(
      asDoc(base),
      aggregateRef(NotificationConfig, base.orgId, base.id),
      1,
    )
    expect(v).toHaveLength(NOTIFICATION_COLUMNS.length)
    expect(v[NOTIFICATION_COLUMNS.indexOf('type')]).toBe('birthday')
    expect(v[NOTIFICATION_COLUMNS.indexOf('source')]).toBe('cron')
    expect(v[NOTIFICATION_COLUMNS.indexOf('dispatch')]).toBeNull()
  })

  it('rowToDoc round-trips a not-dispatched notification (dispatch null → channels null)', () => {
    const doc = notificationRowToDoc(notificationRow(base))
    expect(doc).toMatchObject({
      _version: 1,
      id: 'ntf-1',
      type: 'birthday',
      source: 'cron',
      customerId: 'cust-1',
      dispatchedChannel: null,
      dispatchedBody: null,
    })
  })

  it('dispatch snapshot rides JSONB when dispatched and round-trips', () => {
    const dispatched: NotificationState = {
      ...base,
      dispatchedAt: '2026-06-02T09:00:00.000Z',
      dispatchedChannel: 'whatsapp',
      dispatchedBody: 'Parabéns!',
    }
    const v = notificationColumnValues(
      asDoc(dispatched),
      aggregateRef(NotificationConfig, dispatched.orgId, dispatched.id),
      1,
    )
    expect(v[NOTIFICATION_COLUMNS.indexOf('dispatch')]).toMatchObject({
      dispatchedChannel: 'whatsapp',
      dispatchedBody: 'Parabéns!',
    })
    const doc = notificationRowToDoc(notificationRow(dispatched))
    expect(doc).toMatchObject({
      dispatchedChannel: 'whatsapp',
      dispatchedBody: 'Parabéns!',
    })
  })
})
