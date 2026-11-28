import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import {
  aggregateRef,
  type AggregateRef,
  appendEventToTx,
  runSaga,
  type SagaStep,
} from '@/domain/effect'
import type { Charge } from '@/domain/types/charge'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { PostgresPersistenceLayer } from './postgres-layer'

const ORG = 't1'
const SUB = 'sub1'
const CHARGE = 'ch1'

const chargeRef = (id: string): AggregateRef => aggregateRef(ChargeConfig, ORG, id)
const subscriptionRef = (id: string): AggregateRef => aggregateRef(SubscriptionConfig, ORG, id)

const PLAN = {
  planId: 'plan-basic',
  name: 'Básico',
  priceCents: 9900,
  billingCycle: 'monthly' as const,
  includedItemIds: [],
  includedCategoryIds: [],
  usageLimit: { kind: 'unlimited' as const },
}

function charge(id: string, overrides: Partial<Charge> = {}): Charge {
  return {
    id,
    orgId: ORG,
    unitId: 'unit-a',
    subscriptionId: SUB,
    customerId: 'c1',
    amountCents: 9900,
    periodStartAt: '2026-06-01T00:00:00.000Z',
    periodEndAt: '2026-07-01T00:00:00.000Z',
    dueDate: '2026-06-01T00:00:00.000Z',
    status: 'scheduled',
    attempts: 0,
    paidAt: null,
    failedAt: null,
    failureReason: null,
    refundedAt: null,
    lastActorUid: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function chargeCreatedStep(data: Charge): SagaStep {
  return (tx) =>
    appendEventToTx(
      ChargeConfig,
      chargeRef(data.id),
      { _tag: 'charge.created', actorId: 'test', payload: { data } },
      tx,
    )
}

function subscriptionCreatedStep(): SagaStep {
  return (tx) =>
    appendEventToTx(
      SubscriptionConfig,
      subscriptionRef(SUB),
      {
        _tag: 'subscription.created',
        actorId: 'test',
        payload: {
          id: SUB,
          orgId: ORG,
          unitId: 'unit-a',
          customerId: 'c1',
          customerUserId: null,
          planId: PLAN.planId,
          plan: PLAN,
          periodStart: '2026-06-01T00:00:00.000Z',
          periodEnd: '2026-07-01T00:00:00.000Z',
          nextChargeDate: '2026-07-01T00:00:00.000Z',
          pastDueThreshold: 3,
        },
      },
      tx,
    )
}

const chargeSucceededStep: SagaStep = (tx) =>
  appendEventToTx(
    ChargeConfig,
    chargeRef(CHARGE),
    {
      _tag: 'charge.succeeded',
      actorId: 'test',
      payload: { changes: { status: 'paid', attempts: 1, paidAt: '2026-06-02T00:00:00.000Z' } },
    },
    tx,
  )

const subscriptionSettledStep: SagaStep = (tx) =>
  appendEventToTx(
    SubscriptionConfig,
    subscriptionRef(SUB),
    { _tag: 'subscription.charge_settled', actorId: 'test', payload: {} },
    tx,
  )

function readCount(table: string, ref: AggregateRef): Promise<number> {
  return ownerPool()
    .query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    .then((res) => res.rowCount ?? 0)
}
function readStatus(ref: AggregateRef): Promise<string | null> {
  return ownerPool()
    .query<{ status: string }>('SELECT status FROM charges WHERE org_id = $1 AND id = $2', [
      ref.orgId,
      ref.id,
    ])
    .then((res) => res.rows[0]?.status ?? null)
}
function readNextChargeDate(ref: AggregateRef): Promise<string | null> {
  return ownerPool()
    .query<{ next_charge_date: Date | string | null }>(
      'SELECT next_charge_date FROM subscriptions WHERE org_id = $1 AND id = $2',
      [ref.orgId, ref.id],
    )
    .then((res) => {
      const value = res.rows[0]?.next_charge_date ?? null
      return value == null ? null : new Date(value).toISOString()
    })
}
function readSubStatus(ref: AggregateRef): Promise<string | null> {
  return ownerPool()
    .query<{ status: string }>('SELECT status FROM subscriptions WHERE org_id = $1 AND id = $2', [
      ref.orgId,
      ref.id,
    ])
    .then((res) => res.rows[0]?.status ?? null)
}

async function seedParents(): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
  await ownerPool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,'unit-a',1,'Unit','unit-a','America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
  await ownerPool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,'c1',1,'user-c1',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
}

async function seedChargeAndSubscription(): Promise<void> {
  await Effect.runPromise(
    runSaga([chargeCreatedStep(charge(CHARGE)), subscriptionCreatedStep()]).pipe(
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}

describe('charge ↔ subscription cascade — ACID rollback (Postgres)', () => {
  beforeEach(async () => {
    await ownerPool().query(
      'TRUNCATE events, projections, charges, subscriptions, customers, units, orgs CASCADE',
    )
    await seedParents()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('commits charge.succeeded + subscription.charge_settled together (markChargePaid)', async () => {
    await seedChargeAndSubscription()

    await Effect.runPromise(
      runSaga([chargeSucceededStep, subscriptionSettledStep]).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )

    expect(await readStatus(chargeRef(CHARGE))).toBe('paid')
    expect(await readCount('subscriptions', subscriptionRef(SUB))).toBe(1)
  })

  it('rolls back the WHOLE cascade when the charge step trips a DB CHECK', async () => {
    await seedChargeAndSubscription()

    const renewCharge = charge('ch2', { amountCents: -1 })
    const renewedStep: SagaStep = (tx) =>
      appendEventToTx(
        SubscriptionConfig,
        subscriptionRef(SUB),
        {
          _tag: 'subscription.renewed',
          actorId: 'test',
          payload: {
            periodStart: '2026-07-01T00:00:00.000Z',
            periodEnd: '2026-08-01T00:00:00.000Z',
            nextChargeDate: '2026-08-01T00:00:00.000Z',
          },
        },
        tx,
      )

    const exit = await Effect.runPromiseExit(
      runSaga([chargeCreatedStep(renewCharge), renewedStep]).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(exit._tag).toBe('Failure')

    expect(await readCount('charges', chargeRef('ch2'))).toBe(0)
    expect(await readNextChargeDate(subscriptionRef(SUB))).toBe('2026-07-01T00:00:00.000Z')
  })

  it('commits the markChargeFailed cascade below threshold — charge recovering, sub past_due (#1201)', async () => {
    await seedChargeAndSubscription()

    const chargeFailedStep: SagaStep = (tx) =>
      appendEventToTx(
        ChargeConfig,
        chargeRef(CHARGE),
        {
          _tag: 'charge.failed',
          actorId: 'test',
          payload: {
            changes: {
              status: 'recovering',
              failedAt: '2026-06-02T00:00:00.000Z',
              failureReason: 'card_declined',
              attempts: 1,
              lastActorUid: 'test',
              updatedAt: '2026-06-02T00:00:00.000Z',
            },
          },
        },
        tx,
      )
    const subFailedStep: SagaStep = (tx) =>
      appendEventToTx(
        SubscriptionConfig,
        subscriptionRef(SUB),
        {
          _tag: 'subscription.charge_failed',
          actorId: 'test',
          payload: { reason: 'card_declined', status: 'past_due' },
        },
        tx,
      )

    await Effect.runPromise(
      runSaga([chargeFailedStep, subFailedStep]).pipe(Effect.provide(PostgresPersistenceLayer)),
    )

    expect(await readStatus(chargeRef(CHARGE))).toBe('recovering')
    expect(await readSubStatus(subscriptionRef(SUB))).toBe('past_due')
  })
})
