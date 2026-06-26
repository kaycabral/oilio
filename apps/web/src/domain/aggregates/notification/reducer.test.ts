import { describe, expect, it } from 'vitest'

import type { EventMeta } from '@/domain/effect/event-store'
import { applyNotificationEvent } from './reducer'
import { INITIAL_NOTIFICATION_STATE } from './types'

function meta(version: number, timestamp = '2026-06-01T10:00:00.000Z'): EventMeta {
  return { version, timestamp, actorId: 'system', schemaVersion: 1 }
}

describe('Notification reducer', () => {
  it('notification.created populates all fields', () => {
    const state = applyNotificationEvent(
      INITIAL_NOTIFICATION_STATE,
      {
        _tag: 'notification.created',
        orgId: 't1',
        unitId: 'u1',
        type: 'birthday',
        customerId: 'c1',
        appointmentId: null,
        subscriptionId: null,
        payload: { date: '2026-06-01' },
        source: 'cron',
        eventKey: 'birthday-2026-06-01-customer-c1-unit-u1',
        validUntil: '2026-06-01T23:59:59.999Z',
      },
      meta(1),
    )

    expect(state.orgId).toBe('t1')
    expect(state.unitId).toBe('u1')
    expect(state.type).toBe('birthday')
    expect(state.customerId).toBe('c1')
    expect(state.source).toBe('cron')
    expect(state.eventKey).toBe('birthday-2026-06-01-customer-c1-unit-u1')
    expect(state.validUntil).toBe('2026-06-01T23:59:59.999Z')
    expect(state.createdAt).toBe('2026-06-01T10:00:00.000Z')
    expect(state.readAt).toBeNull()
    expect(state.dispatchedAt).toBeNull()
    expect(state._version).toBe(1)
  })

  it('notification.dispatched sets dispatchedAt', () => {
    const created = applyNotificationEvent(
      INITIAL_NOTIFICATION_STATE,
      {
        _tag: 'notification.created',
        orgId: 't1',
        unitId: 'u1',
        type: 'new_customer',
        customerId: 'c1',
        appointmentId: null,
        subscriptionId: null,
        payload: {},
        source: 'event',
        eventKey: 'new_customer-c1-unit-u1',
        validUntil: null,
      },
      meta(1),
    )

    const dispatched = applyNotificationEvent(
      created,
      { _tag: 'notification.dispatched', channel: 'whatsapp', templateBody: 'Olá' },
      meta(2),
    )

    expect(dispatched.dispatchedAt).toBe('2026-06-01T10:00:00.000Z')
    expect(dispatched._version).toBe(2)
  })

  it('notification.read sets readAt', () => {
    const created = applyNotificationEvent(
      INITIAL_NOTIFICATION_STATE,
      {
        _tag: 'notification.created',
        orgId: 't1',
        unitId: 'u1',
        type: 'cash_register_open',
        customerId: null,
        appointmentId: null,
        subscriptionId: null,
        payload: {},
        source: 'cron',
        eventKey: 'cash-reg-1-unit-u1',
        validUntil: null,
      },
      meta(1),
    )

    const read = applyNotificationEvent(created, { _tag: 'notification.read' }, meta(2))

    expect(read.readAt).toBe('2026-06-01T10:00:00.000Z')
  })

  it('notification.snoozed sets snoozedUntil', () => {
    const created = applyNotificationEvent(
      INITIAL_NOTIFICATION_STATE,
      {
        _tag: 'notification.created',
        orgId: 't1',
        unitId: 'u1',
        type: 'subscription_expired',
        customerId: 'c1',
        appointmentId: null,
        subscriptionId: 's1',
        payload: {},
        source: 'cron',
        eventKey: 'sub-expired-s1-unit-u1',
        validUntil: null,
      },
      meta(1),
    )

    const snoozed = applyNotificationEvent(
      created,
      { _tag: 'notification.snoozed', snoozedUntil: '2026-06-02T09:00:00Z' },
      meta(2),
    )

    expect(snoozed.snoozedUntil).toBe('2026-06-02T09:00:00Z')
  })

  it('notification.expired sets validUntil to timestamp', () => {
    const created = applyNotificationEvent(
      INITIAL_NOTIFICATION_STATE,
      {
        _tag: 'notification.created',
        orgId: 't1',
        unitId: 'u1',
        type: 'subscription_expiring_tomorrow',
        customerId: 'c1',
        appointmentId: null,
        subscriptionId: 's1',
        payload: {},
        source: 'cron',
        eventKey: 'sub-exp-s1-unit-u1',
        validUntil: null,
      },
      meta(1),
    )

    const expired = applyNotificationEvent(created, { _tag: 'notification.expired' }, meta(2))

    expect(expired.validUntil).toBe('2026-06-01T10:00:00.000Z')
    expect(expired._version).toBe(2)
  })

  it('full lifecycle: created → dispatched → read', () => {
    let state = INITIAL_NOTIFICATION_STATE

    state = applyNotificationEvent(
      state,
      {
        _tag: 'notification.created',
        orgId: 't1',
        unitId: 'u1',
        type: 'payment_failure',
        customerId: null,
        appointmentId: null,
        subscriptionId: 's1',
        payload: { reason: 'card_declined' },
        source: 'event',
        eventKey: 'payment-failure-s1-unit-u1',
        validUntil: null,
      },
      meta(1),
    )
    expect(state.readAt).toBeNull()
    expect(state.dispatchedAt).toBeNull()

    state = applyNotificationEvent(
      state,
      { _tag: 'notification.dispatched', channel: 'whatsapp', templateBody: 'Cobrança falhou' },
      meta(2),
    )
    expect(state.dispatchedAt).not.toBeNull()

    state = applyNotificationEvent(state, { _tag: 'notification.read' }, meta(3))
    expect(state.readAt).not.toBeNull()
    expect(state._version).toBe(3)
  })
})
