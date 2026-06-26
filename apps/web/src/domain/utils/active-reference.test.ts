import { describe, expect, it } from 'vitest'
import {
  isActiveMembershipStatus,
  isActiveOrderStatus,
  isActiveSubscriptionStatus,
  isFutureScheduledAppointment,
} from './active-reference'

describe('isActiveSubscriptionStatus', () => {
  it('treats live statuses as active references', () => {
    expect(isActiveSubscriptionStatus('pending')).toBe(true)
    expect(isActiveSubscriptionStatus('active')).toBe(true)
    expect(isActiveSubscriptionStatus('past_due')).toBe(true)
    expect(isActiveSubscriptionStatus('suspended')).toBe(true)
  })

  it('treats terminal statuses as historical (not active)', () => {
    expect(isActiveSubscriptionStatus('cancelled')).toBe(false)
    expect(isActiveSubscriptionStatus('cancelled_for_non_payment')).toBe(false)
  })
})

describe('isActiveOrderStatus', () => {
  it('only an open order holds an active reference', () => {
    expect(isActiveOrderStatus('open')).toBe(true)
    expect(isActiveOrderStatus('closed')).toBe(false)
    expect(isActiveOrderStatus('cancelled')).toBe(false)
  })
})

describe('isFutureScheduledAppointment', () => {
  const now = new Date('2026-06-04T12:00:00.000Z')

  it('a future scheduled appointment is an active reference', () => {
    expect(
      isFutureScheduledAppointment(
        { status: 'scheduled', startAt: '2026-06-05T10:00:00.000Z' },
        now,
      ),
    ).toBe(true)
  })

  it('a past scheduled appointment is historical', () => {
    expect(
      isFutureScheduledAppointment(
        { status: 'scheduled', startAt: '2026-06-03T10:00:00.000Z' },
        now,
      ),
    ).toBe(false)
  })

  it('completed / cancelled / no_show never count, even if future-dated', () => {
    const future = '2026-06-10T10:00:00.000Z'
    expect(isFutureScheduledAppointment({ status: 'completed', startAt: future }, now)).toBe(false)
    expect(isFutureScheduledAppointment({ status: 'cancelled', startAt: future }, now)).toBe(false)
    expect(isFutureScheduledAppointment({ status: 'no_show', startAt: future }, now)).toBe(false)
  })
})

describe('isActiveMembershipStatus', () => {
  it('every non-severed status keeps the member a live dependency', () => {
    expect(isActiveMembershipStatus('active')).toBe(true)
    expect(isActiveMembershipStatus('invited')).toBe(true)
    expect(isActiveMembershipStatus('suspended')).toBe(true)
  })

  it('revoked is the terminal severance (offboarding) → historical', () => {
    expect(isActiveMembershipStatus('revoked')).toBe(false)
  })
})
