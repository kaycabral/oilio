// The builders exist to produce schema-VALID docs (the seeds that wrote partial
// docs were silently illegal under the tightened domain schemas). So the test
// that matters is: each builder's output decodes through its domain schema, and
// the invariant branches (cancelled→cancelledAt, accepted→acceptedAt, paid→
// paidAt, completed account→PII) stay legal — both the satisfied case AND the
// violated case the refinement is there to reject. A field added to a type that
// the builder forgets fails here.

import {
  Appointment,
  Charge,
  Commission,
  Invite,
  Membership,
  StoredCustomer,
  Subscription,
  User,
} from '@/domain'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  buildAppointment,
  buildCharge,
  buildCommission,
  buildInvite,
  buildMembership,
  buildStoredCustomer,
  buildSubscription,
  buildUser,
} from './domain-builders'

const NOW = '2026-06-15T12:00:00.000Z'
const decodes = (schema: Schema.Schema.AnyNoContext, value: unknown): void => {
  expect(() => {
    Schema.decodeUnknownSync(schema)(value)
  }).not.toThrow()
}
const rejects = (schema: Schema.Schema.AnyNoContext, value: unknown): void => {
  expect(() => {
    Schema.decodeUnknownSync(schema)(value)
  }).toThrow()
}

describe('domain builders produce schema-valid docs', () => {
  it('buildUser — incomplete default and completed branch', () => {
    decodes(User, buildUser('u1', NOW))
    decodes(User, buildUser('u1', NOW, { completionCompleted: true, mobile: '5511999990000' }))
  })

  it('buildStoredCustomer', () => {
    decodes(StoredCustomer, buildStoredCustomer('c1', 't1', 'u1', NOW))
  })

  it('buildSubscription — active default and cancelled branch', () => {
    const active = buildSubscription('s1', 't1', NOW)
    expect(active.cancelledAt).toBeNull()
    decodes(Subscription, active)

    const cancelled = buildSubscription('s1', 't1', NOW, { status: 'cancelled' })
    expect(cancelled.cancelledAt).not.toBeNull()
    decodes(Subscription, cancelled)
  })

  it('buildAppointment — customerUserId is non-null', () => {
    const appt = buildAppointment('a1', 't1', NOW)
    expect(appt.customerUserId).toBeTypeOf('string')
    decodes(Appointment, appt)
  })

  it('buildCharge — scheduled default and paid branch', () => {
    const scheduled = buildCharge('ch1', 't1', NOW)
    expect(scheduled.paidAt).toBeNull()
    decodes(Charge, scheduled)

    const paid = buildCharge('ch1', 't1', NOW, { status: 'paid' })
    expect(paid.paidAt).not.toBeNull()
    decodes(Charge, paid)
  })

  it('buildMembership', () => {
    decodes(Membership, buildMembership('t1', 'u1', NOW))
  })

  it('buildInvite — pending default and accepted branch', () => {
    const pending = buildInvite('i1', 't1', NOW)
    expect(pending.acceptedByUid).toBeNull()
    decodes(Invite, pending)

    const accepted = buildInvite('i1', 't1', NOW, { status: 'accepted' })
    expect(accepted.acceptedByUid).not.toBeNull()
    decodes(Invite, accepted)
  })

  it('buildCommission — pendente default and pago branch', () => {
    const pendente = buildCommission('cm1', 't1', NOW)
    expect(pendente.paidAt).toBeNull()
    decodes(Commission, pendente)

    const pago = buildCommission('cm1', 't1', NOW, { liquidationStatus: 'pago' })
    expect(pago.paidAt).not.toBeNull()
    decodes(Commission, pago)
  })
})

describe('domain refinements reject the illegal states they exist to forbid', () => {
  it('Subscription — active with a cancelledAt is rejected', () => {
    rejects(Subscription, { ...buildSubscription('s1', 't1', NOW), cancelledAt: NOW })
  })

  it('Subscription — cancelled without a cancelledAt is rejected', () => {
    rejects(
      Subscription,
      buildSubscription('s1', 't1', NOW, { status: 'cancelled', cancelledAt: null }),
    )
  })

  it('Invite — pending carrying acceptance fields is rejected', () => {
    rejects(Invite, { ...buildInvite('i1', 't1', NOW), acceptedByUid: 'x', acceptedAt: NOW })
  })

  it('Commission — pendente carrying a paidAt is rejected', () => {
    rejects(Commission, { ...buildCommission('cm1', 't1', NOW), paidAt: NOW })
  })
})
