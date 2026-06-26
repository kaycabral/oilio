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
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { PostgresPersistenceLayer } from './postgres-layer'

/**
 * ACID rollback of the CHARGE ↔ SUBSCRIPTION cascades against REAL Postgres
 * (#1200). The `markChargePaid` / `markChargeFailed` / `renewSubscription`
 * actions run their two-aggregate cascade through `commitSaga` → `runSaga` under
 * the Postgres layer; this proves the invariant those actions rely on: when a
 * step mid-cascade violates a DB constraint, the WHOLE transaction rolls back —
 * the charge is never left paid/created while the subscription mutation is lost
 * (or vice-versa). The happy cascade commits both aggregates together.
 *
 * We exercise the primitive (`runSaga` + `appendEventToTx`) directly with the
 * cascade shapes the actions emit. The rollback step carries `amountCents: -1`
 * on a `charge.created` — schema-valid (`Schema.Number`), but it trips the DB
 * `charges_amount_cents_nonneg` CHECK at projection time, so the failure comes
 * from the transaction boundary, exactly like a real constraint breach would.
 *
 * globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
 * database (docker locally, services:postgres in CI).
 */

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

// Projection tables are keyed by composite PK (org_id, id) (D6, ADR 0013) — read
// by the ref's org/id, never a path.
function readCount(table: string, ref: AggregateRef): Promise<number> {
  return getEventStorePool()
    .query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    .then((res) => res.rowCount ?? 0)
}
function readStatus(ref: AggregateRef): Promise<string | null> {
  return getEventStorePool()
    .query<{ status: string }>('SELECT status FROM charges WHERE org_id = $1 AND id = $2', [
      ref.orgId,
      ref.id,
    ])
    .then((res) => res.rows[0]?.status ?? null)
}
function readNextChargeDate(ref: AggregateRef): Promise<string | null> {
  return getEventStorePool()
    .query<{ next_charge_date: Date | string | null }>(
      'SELECT next_charge_date FROM subscriptions WHERE org_id = $1 AND id = $2',
      [ref.orgId, ref.id],
    )
    .then((res) => {
      // `next_charge_date` is `timestamptz` (brief 0068 D1): the pg driver hands
      // back a `Date` on this raw read. Normalize to ISO so the assertion
      // compares like-for-like (mirrors the projector's `rowToDoc`).
      const value = res.rows[0]?.next_charge_date ?? null
      return value == null ? null : new Date(value).toISOString()
    })
}
function readSubStatus(ref: AggregateRef): Promise<string | null> {
  return getEventStorePool()
    .query<{ status: string }>('SELECT status FROM subscriptions WHERE org_id = $1 AND id = $2', [
      ref.orgId,
      ref.id,
    ])
    .then((res) => res.rows[0]?.status ?? null)
}

// The subscription/charge projections now carry org/unit/customer FKs (brief
// 0068 D2): seed the parent rows so the saga writes satisfy them. The
// `charges_subscription_id_fk` is DEFERRABLE (the saga appends the charge before
// the subscription in the same tx) so it needs no standalone seed.
async function seedParents(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,'unit-a',1,'Unit','unit-a','America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
  await getEventStorePool().query(
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
    await getEventStorePool().query(
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
    // Settling a non-cancelled subscription keeps it active — the cascade landed.
    expect(await readCount('subscriptions', subscriptionRef(SUB))).toBe(1)
  })

  it('rolls back the WHOLE cascade when the charge step trips a DB CHECK', async () => {
    await seedChargeAndSubscription()

    // The renew cascade: a NEW charge (`charge.created`) then `subscription
    // .renewed`. The new charge carries a negative amount → trips
    // `charges_amount_cents_nonneg`. Schema accepts it (Number), the DB does not.
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

    // The bad charge never landed AND the subscription.renewed mutation rolled
    // back with it — nextChargeDate stays the ORIGINAL seed value, never the
    // renewed one (2026-08-01), proving the whole cascade reverted as one tx.
    expect(await readCount('charges', chargeRef('ch2'))).toBe(0)
    expect(await readNextChargeDate(subscriptionRef(SUB))).toBe('2026-07-01T00:00:00.000Z')
  })

  it('commits the markChargeFailed cascade below threshold — charge recovering, sub past_due (#1201)', async () => {
    await seedChargeAndSubscription()

    // Below CHARGE_FAILURE_THRESHOLD the charge goes `recovering` (a valid
    // ChargeStatus), NOT `past_due`. Before #1201 the failure policy returned
    // `past_due` for the charge — not a ChargeStatus — so `charge.failed` tripped
    // schema validation and the whole tx rolled back. The shape below mirrors what
    // `markChargeFailed` emits via `buildMarkFailedSteps`; this proves it commits.
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
