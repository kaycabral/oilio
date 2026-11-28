import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { loadDashboardTrend } from '@/features/dashboard/adapters/trend.repo'
import { resolveDashboardFilters } from '@/features/dashboard/core/filters'
import { buildMarkPaidSteps } from '@/features/subscriptions/adapters/subscription-charges-saga'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { commitGuardedThenAppend } from '@/shared/effect-bridge'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const ORG = 't1'
const UNIT = 'u1'
const TZ = 'America/Sao_Paulo'

const PLAN = {
  planId: 'plan-basic',
  name: 'Básico',
  priceCents: 9900,
  billingCycle: 'monthly' as const,
  includedItemIds: [],
  includedCategoryIds: [],
  usageLimit: { kind: 'unlimited' as const },
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
     VALUES ($1,'u1',1,'Unit','unit-u1',$2,'always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, TZ],
  )
  for (const c of ['c1', 'c2', 'c3']) {
    await ownerPool().query(
      `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
       VALUES ($1,$2,1,'user-'||$2,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
       ON CONFLICT (org_id, id) DO NOTHING`,
      [ORG, c],
    )
  }
}

async function birthSubscriptionWithCompetence(opts: {
  subId: string
  chargeId: string
  customerId: string
  writtenNow: string
  competenceStart: string
  competenceEnd: string
}): Promise<void> {
  const subscriptionRef = aggregateRef(SubscriptionConfig, ORG, opts.subId)
  const chargeRef = aggregateRef(ChargeConfig, ORG, opts.chargeId)

  const result = await commitGuardedThenAppend(
    {
      config: SubscriptionConfig,
      ref: subscriptionRef,
      actorId: 'test',
      tag: 'subscription.created',
      guard: () =>
        Effect.succeed({
          _tag: 'ok' as const,
          payload: {
            id: opts.subId,
            orgId: ORG,
            unitId: UNIT,
            customerId: opts.customerId,
            customerUserId: null,
            planId: PLAN.planId,
            plan: PLAN,
            periodStart: opts.competenceStart,
            periodEnd: opts.competenceEnd,
            nextChargeDate: opts.competenceEnd,
            pastDueThreshold: 3,
          },
        }),
    },
    {
      config: ChargeConfig,
      ref: chargeRef,
      buildEvent: () => ({
        _tag: 'charge.created' as const,
        actorId: 'test',
        payload: {
          data: {
            id: opts.chargeId,
            orgId: ORG,
            unitId: UNIT,
            subscriptionId: opts.subId,
            customerId: opts.customerId,
            amountCents: PLAN.priceCents,
            periodStartAt: opts.competenceStart,
            periodEndAt: opts.competenceEnd,
            dueDate: opts.competenceStart,
            status: 'scheduled' as const,
            attempts: 0,
            paidAt: null,
            failedAt: null,
            failureReason: null,
            refundedAt: null,
            lastActorUid: null,
            createdAt: opts.writtenNow,
            updatedAt: opts.writtenNow,
          },
        },
      }),
      buildExtraSteps: () =>
        buildMarkPaidSteps({
          orgId: ORG,
          actorId: 'test',
          chargeId: opts.chargeId,
          subscriptionId: opts.subId,
          attempts: 0,
          now: opts.writtenNow,
          periodStartAt: opts.competenceStart,
          amountCents: PLAN.priceCents,
          unitId: UNIT,
          settle: true,
        }),
    },
  )
  expect(result).toEqual({ ok: true })
}

function newSubsByDate(
  points: Awaited<ReturnType<typeof loadDashboardTrend>>,
): Record<string, number> {
  return Object.fromEntries(points.filter((p) => p.newSubs > 0).map((p) => [p.date, p.newSubs]))
}

const MAY_WINDOW = { period: 'custom', from: '2026-05-01', to: '2026-05-31' } as const
const WRITTEN_NOW = '2026-07-17T18:00:00.000Z'

describe('dashboard trend — subscription competence (Postgres) (#1420)', () => {
  beforeEach(async () => {
    await ownerPool().query(
      'TRUNCATE events, projections, subscriptions, charges, customers, units, orgs CASCADE',
    )
    await seedParents()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('counts a retroactive subscription on its competence day, not the write date', async () => {
    await birthSubscriptionWithCompetence({
      subId: 'sub-retro',
      chargeId: 'ch-retro',
      customerId: 'c1',
      writtenNow: WRITTEN_NOW,
      competenceStart: '2026-05-10T03:00:00.000Z',
      competenceEnd: '2026-06-10T03:00:00.000Z',
    })

    const filters = resolveDashboardFilters(MAY_WINDOW, TZ)
    const points = await loadDashboardTrend(ORG, TZ, { ...filters, unitId: null })

    expect(newSubsByDate(points)).toEqual({ '2026-05-10': 1 })
  })

  it('excludes a subscription whose competence falls outside the window even when written inside it', async () => {
    await birthSubscriptionWithCompetence({
      subId: 'sub-april',
      chargeId: 'ch-april',
      customerId: 'c2',
      writtenNow: '2026-05-15T18:00:00.000Z',
      competenceStart: '2026-04-20T03:00:00.000Z',
      competenceEnd: '2026-05-20T03:00:00.000Z',
    })

    const filters = resolveDashboardFilters(MAY_WINDOW, TZ)
    const points = await loadDashboardTrend(ORG, TZ, { ...filters, unitId: null })

    expect(newSubsByDate(points)).toEqual({})
  })

  it('buckets multiple subscriptions on their own competence days', async () => {
    await birthSubscriptionWithCompetence({
      subId: 'sub-a',
      chargeId: 'ch-a',
      customerId: 'c1',
      writtenNow: WRITTEN_NOW,
      competenceStart: '2026-05-03T03:00:00.000Z',
      competenceEnd: '2026-06-03T03:00:00.000Z',
    })
    await birthSubscriptionWithCompetence({
      subId: 'sub-b',
      chargeId: 'ch-b',
      customerId: 'c2',
      writtenNow: WRITTEN_NOW,
      competenceStart: '2026-05-03T15:00:00.000Z',
      competenceEnd: '2026-06-03T15:00:00.000Z',
    })
    await birthSubscriptionWithCompetence({
      subId: 'sub-c',
      chargeId: 'ch-c',
      customerId: 'c3',
      writtenNow: WRITTEN_NOW,
      competenceStart: '2026-05-25T03:00:00.000Z',
      competenceEnd: '2026-06-25T03:00:00.000Z',
    })

    const filters = resolveDashboardFilters(MAY_WINDOW, TZ)
    const points = await loadDashboardTrend(ORG, TZ, { ...filters, unitId: null })

    expect(newSubsByDate(points)).toEqual({ '2026-05-03': 2, '2026-05-25': 1 })
  })
})
