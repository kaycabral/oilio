import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef, type AggregateRef } from '@/domain/effect'
import { commitGuardedThenAppend } from '@/shared/effect-bridge'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * ACID guarantee of the CREATE-SUBSCRIPTION guarded cascade against REAL Postgres
 * (brief 0064 § Grupo B). `createSubscription` runs `commitGuardedThenAppend`:
 * the guarded `subscription.created` + the dependent `charge.created`, in ONE
 * tx. The happy path is already covered end-to-end by the unit-context journey
 * e2e, and the ACID primitive by `charge-subscription-saga-acid`; what was only
 * proven IN-MEMORY (effect-bridge.test.ts mocks the layer) is the **reject path**
 * — when the guard rejects, NEITHER aggregate may land. This proves it against
 * a real Postgres transaction.
 *
 * Note on the mechanism: on reject the guard SHORT-CIRCUITS before writing the
 * subscription, so `commitGuardedThenAppend` never appends the charge either —
 * the tx commits empty (zero rows of both), rather than writing-then-rolling-back.
 * Either way the invariant holds: a rejected create-subscription leaves NOTHING.
 *
 * globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
 * database (docker locally, services:postgres in CI).
 */

const ORG = 't1'
const SUB = 'sub-1'
const CHARGE = 'ch-1'

const subscriptionRef: AggregateRef = aggregateRef(SubscriptionConfig, ORG, SUB)
const chargeRef: AggregateRef = aggregateRef(ChargeConfig, ORG, CHARGE)

const PLAN = {
  planId: 'plan-basic',
  name: 'Básico',
  priceCents: 9900,
  billingCycle: 'monthly' as const,
  includedItemIds: [],
  includedCategoryIds: [],
  usageLimit: { kind: 'unlimited' as const },
}

const subscriptionData = {
  id: SUB,
  orgId: ORG,
  unitId: 'u1',
  customerId: 'c1',
  customerUserId: null,
  planId: PLAN.planId,
  plan: PLAN,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  nextChargeDate: '2026-07-01T00:00:00.000Z',
  pastDueThreshold: 3,
}

function buildChargeEvent() {
  return {
    _tag: 'charge.created' as const,
    actorId: 'test',
    payload: {
      data: {
        id: CHARGE,
        orgId: ORG,
        unitId: 'u1',
        subscriptionId: SUB,
        customerId: 'c1',
        amountCents: 9900,
        periodStartAt: '2026-06-01T00:00:00.000Z',
        periodEndAt: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-06-01T00:00:00.000Z',
        status: 'scheduled' as const,
        attempts: 0,
        paidAt: null,
        failedAt: null,
        failureReason: null,
        lastActorUid: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    },
  }
}

// Projection tables are keyed by composite PK (org_id, id) (D6, ADR 0013).
function readCount(table: string, ref: AggregateRef): Promise<number> {
  return getEventStorePool()
    .query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    .then((res) => res.rowCount ?? 0)
}

// The subscription/charge projections now carry org/unit/customer FKs (brief
// 0068 D2): seed the parent rows so the guarded cascade can land. The
// `charges_subscription_id_fk` is DEFERRABLE (charge appended before the
// subscription in the same tx), so it needs no standalone seed.
async function seedParents(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,'u1',1,'Unit','unit-u1','America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
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

describe('create-subscription guarded cascade — ACID (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, subscriptions, charges, customers, units, orgs CASCADE',
    )
    await seedParents()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('commits subscription + charge together when the guard passes', async () => {
    const result = await commitGuardedThenAppend(
      {
        config: SubscriptionConfig,
        ref: subscriptionRef,
        actorId: 'test',
        tag: 'subscription.created',
        guard: () => Effect.succeed({ _tag: 'ok' as const, payload: subscriptionData }),
      },
      ChargeConfig,
      chargeRef,
      buildChargeEvent,
    )

    expect(result).toEqual({ ok: true })
    expect(await readCount('subscriptions', subscriptionRef)).toBe(1)
    expect(await readCount('charges', chargeRef)).toBe(1)
  })

  // AC-04 — the gap that was only proven in-memory: guard reject → ZERO rows of
  // BOTH aggregates against a real Postgres tx (the guard short-circuits before
  // writing either, so the tx commits empty — nothing lands).
  it('leaves ZERO rows of both aggregates when the guard rejects (nothing lands)', async () => {
    const result = await commitGuardedThenAppend(
      {
        config: SubscriptionConfig,
        ref: subscriptionRef,
        actorId: 'test',
        tag: 'subscription.created',
        guard: () =>
          Effect.succeed({ _tag: 'reject' as const, message: 'customer já tem assinatura ativa' }),
      },
      ChargeConfig,
      chargeRef,
      buildChargeEvent,
    )

    expect(result).toEqual({ ok: false, error: 'customer já tem assinatura ativa' })
    // Neither the subscription nor its dependent charge may persist.
    expect(await readCount('subscriptions', subscriptionRef)).toBe(0)
    expect(await readCount('charges', chargeRef)).toBe(0)
  })
})
