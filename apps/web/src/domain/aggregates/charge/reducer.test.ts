import { describe, expect, it } from 'vitest'

import type { EventMeta } from '@/domain/effect/event-store'
import type { Charge } from '@/domain/types/charge'
import { applyChargeEvent } from './reducer'
import { INITIAL_CHARGE_STATE, type ChargeState } from './types'

function meta(version: number, timestamp = '2026-06-01T10:00:00.000Z'): EventMeta {
  return { version, timestamp, actorId: 'user-1', schemaVersion: 1 }
}

// `charge.created` snapshots the full operational doc (the action builds a
// complete `Charge`), so the event payload is the full shape.
const CREATED_DATA: Charge = {
  id: 'ch1',
  tenantId: 't1',
  unitId: 'u1',
  subscriptionId: 's1',
  customerId: 'c1',
  amountCents: 9000,
  periodStartAt: '2026-06-01',
  periodEndAt: '2026-07-01',
  dueDate: '2026-07-01',
  status: 'scheduled',
  attempts: 0,
  paidAt: null,
  failedAt: null,
  failureReason: null,
  lastActorUid: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
}

function created(): ChargeState {
  return applyChargeEvent(
    INITIAL_CHARGE_STATE,
    { _tag: 'charge.created', data: CREATED_DATA },
    meta(1),
  )
}

describe('applyChargeEvent', () => {
  it('created applies the payload data and advances the version', () => {
    const state = created()
    expect(state).toMatchObject(CREATED_DATA)
    expect(state._version).toBe(1)
  })

  // succeeded / failed / cancelled share one change-applying branch. Each tag
  // must reach it (not fall through to the default no-op) — a blanked case
  // label would drop the changes.
  it('succeeded applies the changes', () => {
    const state = applyChargeEvent(
      created(),
      { _tag: 'charge.succeeded', changes: { status: 'paid', paidAt: '2026-07-01T12:00:00.000Z' } },
      meta(2),
    )
    expect(state.status).toBe('paid')
    expect(state.paidAt).toBe('2026-07-01T12:00:00.000Z')
  })

  it('failed applies the changes', () => {
    const state = applyChargeEvent(
      created(),
      {
        _tag: 'charge.failed',
        changes: { status: 'failed', failureReason: 'card_declined', attempts: 1 },
      },
      meta(2),
    )
    expect(state.status).toBe('failed')
    expect(state.failureReason).toBe('card_declined')
    expect(state.attempts).toBe(1)
  })

  it('cancelled applies the changes', () => {
    const state = applyChargeEvent(
      created(),
      { _tag: 'charge.cancelled', changes: { status: 'cancelled' } },
      meta(2),
    )
    expect(state.status).toBe('cancelled')
  })

  it('advances _version on every event', () => {
    const state = applyChargeEvent(created(), { _tag: 'charge.succeeded', changes: {} }, meta(9))
    expect(state._version).toBe(9)
  })
})
