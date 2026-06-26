import { describe, expect, it } from 'vitest'
import { filterNotificationsForRole, toNotificationView } from './notification-list'

describe('toNotificationView', () => {
  it('maps a full doc into the typed view-model', () => {
    const v = toNotificationView({
      id: 'n1',
      data: {
        type: 'birthday',
        customerId: 'c1',
        subscriptionId: 's1',
        payload: { foo: 'bar' },
        createdAt: '2026-06-01T00:00:00.000Z',
        readAt: '2026-06-02T00:00:00.000Z',
        dispatchedAt: '2026-06-03T00:00:00.000Z',
        unitId: 'u1',
        source: 'cron',
      },
    })
    expect(v).toEqual({
      id: 'n1',
      type: 'birthday',
      customerId: 'c1',
      subscriptionId: 's1',
      payload: { foo: 'bar' },
      createdAt: '2026-06-01T00:00:00.000Z',
      readAt: '2026-06-02T00:00:00.000Z',
      dispatchedAt: '2026-06-03T00:00:00.000Z',
      unitId: 'u1',
      source: 'cron',
    })
  })

  it('coerces missing/wrong-typed fields to safe defaults', () => {
    const v = toNotificationView({ id: 'n2', data: {} })
    expect(v).toEqual({
      id: 'n2',
      type: '',
      customerId: null,
      subscriptionId: null,
      payload: {},
      createdAt: null,
      readAt: null,
      dispatchedAt: null,
      unitId: '',
      source: '',
    })
  })

  it('rejects a non-object payload', () => {
    const v = toNotificationView({ id: 'n3', data: { payload: 'nope' } })
    expect(v.payload).toEqual({})
  })
})

describe('filterNotificationsForRole', () => {
  const docs = [
    { id: 'a', data: { type: 'birthday' } },
    { id: 'b', data: { type: 'cash_register_open' } },
    { id: 'c', data: { type: 'payment_failure' } },
    { id: 'd', data: { type: 'new_customer' } },
  ]

  it('receptionist does not see manager-only financial types', () => {
    const out = filterNotificationsForRole(docs, 'receptionist')
    expect(out.map((n) => n.id)).toEqual(['a', 'd'])
  })

  it('manager sees every type', () => {
    const out = filterNotificationsForRole(docs, 'manager')
    expect(out.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('owner sees every type', () => {
    const out = filterNotificationsForRole(docs, 'owner')
    expect(out).toHaveLength(4)
  })
})
