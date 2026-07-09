import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import type { AggregateRef } from '../effect/aggregate-ref'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate, type AggregateConfig } from '../effect/event-store'
import { defaultPermissionsForRole } from '../types/membership'
import { CashMovementConfig } from './cash-movement/config'
import { ChargeConfig } from './charge/config'
import { CommissionConfig } from './commission/config'
import { MembershipConfig } from './membership/config'
import { OrderConfig } from './order/config'

async function checkDod<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  ref: AggregateRef,
  createdTag: Event['_tag'],
  data: Record<string, unknown>,
): Promise<void> {
  const { store, events, layer } = makeReplayStore()

  await Effect.runPromise(
    appendEvent(config, ref, {
      _tag: createdTag,
      actorId: 'actor-1',
      payload: { data },
    }).pipe(Effect.provide(layer)),
  )

  const event = events.get(docKey(ref))?.[0]
  const projection = store.get(docKey(ref))
  expect(event, 'evento no stream').toBeTruthy()
  expect(projection, 'projeção derivada').toBeTruthy()

  expect(event!['actorId']).toBe('actor-1')
  expect(event!['_tag']).toBe(createdTag)
  expect(typeof event!['timestamp']).toBe('string')

  const replayed = await Effect.runPromise(replayAggregate(config, ref).pipe(Effect.provide(layer)))
  expect(replayed).toEqual(projection)
  expect(replayed._version).toBe(1)
}

const CASES: { name: string; run: () => Promise<void> }[] = [
  {
    name: 'membership',
    run: () =>
      checkDod(
        MembershipConfig,
        aggregateRef(MembershipConfig, 't1', 't1_u1'),
        'membership.created',
        {
          id: 't1_u1',
          orgId: 't1',
          userId: 'u1',
          role: 'owner',
          status: 'active',
          invitedBy: null,
          joinedAt: '2026-06-01T12:00:00.000Z',
          updatedAt: '2026-06-01T12:00:00.000Z',
          rlsUnitScope: null,
          permissions: defaultPermissionsForRole('owner'),
        },
      ),
  },
  {
    name: 'commission',
    run: () =>
      checkDod(CommissionConfig, aggregateRef(CommissionConfig, 't1', 'c1'), 'commission.created', {
        id: 'c1',
        orgId: 't1',
        orderId: 'o1',
        orderItemId: 'item-1',
        attributedUserId: 'pro-1',
        attributedMemberName: 'Zé Profissional',
        itemKind: 'service',
        itemName: 'Corte',
        itemTotalCents: 5000,
        commissionKind: 'percentage',
        commissionValue: 50,
        amountCents: 2500,
        createdAt: '2026-06-01T12:00:00.000Z',
      }),
  },
  {
    name: 'order',
    run: () =>
      checkDod(OrderConfig, aggregateRef(OrderConfig, 't1', 'o1'), 'order.created', {
        id: 'o1',
        orgId: 't1',
        unitId: 'u1',
        customerId: null,
        appointmentId: null,
        status: 'open',
        items: [],
        discountCents: 0,
        closedAt: null,
        paymentMethod: null,
        subtotalCents: 0,
        totalCents: 0,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      }),
  },
  {
    name: 'charge',
    run: () =>
      checkDod(ChargeConfig, aggregateRef(ChargeConfig, 't1', 'ch1'), 'charge.created', {
        id: 'ch1',
        orgId: 't1',
        unitId: 'u1',
        subscriptionId: 's1',
        customerId: 'c1',
        amountCents: 9900,
        periodStartAt: '2026-06-01T00:00:00.000Z',
        periodEndAt: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-07-01T00:00:00.000Z',
        status: 'scheduled',
        attempts: 0,
        paidAt: null,
        failedAt: null,
        failureReason: null,
        refundedAt: null,
        lastActorUid: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      }),
  },
  {
    name: 'cash-movement',
    run: () =>
      checkDod(
        CashMovementConfig,
        aggregateRef(CashMovementConfig, 't1', 'm1'),
        'cash_movement.created',
        {
          id: 'm1',
          orgId: 't1',
          unitId: 'u1',
          kind: 'sale',
          direction: 'in',
          amountCents: 5000,
          paymentMethod: 'cash',
          description: null,
          orderId: 'o1',
          expenseCategoryId: null,
          recordedByUid: 'actor-1',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
      ),
  },
]

describe('Feature 0025 — Definition of Done (conformidade ES total)', () => {
  for (const c of CASES) {
    it(`${c.name}: event-first + auditoria no stream + replay == projeção`, c.run)
  }
})
