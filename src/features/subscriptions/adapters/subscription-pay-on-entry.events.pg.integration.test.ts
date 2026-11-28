import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef, type AggregateRef } from '@/domain/effect'
import {
  buildMarkPaidSteps,
  buildSettleGuardedStep,
} from '@/features/subscriptions/adapters/subscription-charges-saga'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { commitGuardedThenAppend } from '@/shared/effect-bridge'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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
        refundedAt: null,
        lastActorUid: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    },
  }
}

function readCount(table: string, ref: AggregateRef): Promise<number> {
  return ownerPool()
    .query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    .then((res) => res.rowCount ?? 0)
}

function readStatus(table: string, ref: AggregateRef): Promise<string | null> {
  return ownerPool()
    .query<{ status: string }>(`SELECT status FROM ${table} WHERE org_id = $1 AND id = $2`, [
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
     VALUES ($1,'u1',1,'Unit','unit-u1','America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
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

describe('subscription pay-on-entry + settle guard — ACID (Postgres) (#1394)', () => {
  beforeEach(async () => {
    await ownerPool().query(
      'TRUNCATE events, projections, subscriptions, charges, customers, units, orgs CASCADE',
    )
    await seedParents()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('pay-on-entry: subscription is born active with the first charge settled in the same tx', async () => {
    const result = await commitGuardedThenAppend(
      {
        config: SubscriptionConfig,
        ref: subscriptionRef,
        actorId: 'test',
        tag: 'subscription.created',
        guard: () => Effect.succeed({ _tag: 'ok' as const, payload: subscriptionData }),
      },
      {
        config: ChargeConfig,
        ref: chargeRef,
        buildEvent: buildChargeEvent,
        buildExtraSteps: () =>
          buildMarkPaidSteps({
            orgId: ORG,
            actorId: 'test',
            chargeId: CHARGE,
            subscriptionId: SUB,
            attempts: 0,
            now: '2026-06-01T00:00:00.000Z',
            periodStartAt: '2026-06-01T00:00:00.000Z',
            amountCents: 9900,
            unitId: 'u1',
            settle: true,
          }),
      },
    )

    expect(result).toEqual({ ok: true })
    expect(await readStatus('subscriptions', subscriptionRef)).toBe('active')
    expect(await readStatus('charges', chargeRef)).toBe('paid')
  })

  it('the settle guard rejects (whole tx rolls back) when the backing charge is not paid', async () => {
    const result = await commitGuardedThenAppend(
      {
        config: SubscriptionConfig,
        ref: subscriptionRef,
        actorId: 'test',
        tag: 'subscription.created',
        guard: () => Effect.succeed({ _tag: 'ok' as const, payload: subscriptionData }),
      },
      {
        config: ChargeConfig,
        ref: chargeRef,
        buildEvent: buildChargeEvent,
        buildExtraSteps: () => [
          buildSettleGuardedStep({
            orgId: ORG,
            actorId: 'test',
            chargeId: CHARGE,
            subscriptionId: SUB,
          }),
        ],
      },
    )

    expect(result).toEqual({
      ok: false,
      error: 'Liquidação exige uma cobrança paga correspondente',
    })
    expect(await readCount('subscriptions', subscriptionRef)).toBe(0)
    expect(await readCount('charges', chargeRef)).toBe(0)
  })
})
