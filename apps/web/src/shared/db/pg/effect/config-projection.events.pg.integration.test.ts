import { AgendaBlockConfig } from '@/domain/aggregates/agenda-block/config'
import { CategoryConfig } from '@/domain/aggregates/category/config'
import { CustomerConfig } from '@/domain/aggregates/customer/config'
import { GoalConfig } from '@/domain/aggregates/goal/config'
import { InviteConfig } from '@/domain/aggregates/invite/config'
import { NotificationConfig } from '@/domain/aggregates/notification/config'
import { ProfessionalConfig } from '@/domain/aggregates/professional/config'
import { SubscriptionPlanConfig } from '@/domain/aggregates/subscription-plan/config'
import { appendEvent, replayAggregate } from '@/domain/effect'
import type { AgendaBlock } from '@/domain/types/agenda-block'
import type { Category } from '@/domain/types/category'
import type { StoredCustomer } from '@/domain/types/customer'
import type { Goal } from '@/domain/types/goal'
import type { StoredInvite } from '@/domain/types/invite'
import type { StoredProfessional } from '@/domain/types/professional'
import type { SubscriptionPlan } from '@/domain/types/subscription-plan'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { deletePostgresProjection, PostgresPersistenceLayer } from './postgres-layer'

/**
 * Typed projection routing for the CONFIG contexts (brief 0060, feature D,
 * AC-01) — the 8 aggregates D migrates. Mirrors `identity-projection.events.pg.
 * integration.test.ts`. Proves, per aggregate:
 *   - a real `create` through the event store lands in the TYPED table (not the
 *     generic `projections` JSONB store), in the SAME tx as the event;
 *   - `replayAggregate` reconstructs the typed state (union bodies round-trip);
 *   - the DATABASE refuses an invariant violation (enum CHECK / non-empty /
 *     positive) via a raw write, independent of the domain schema.
 *
 * globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
 * database (docker locally, services:postgres in CI).
 */

const ORG = 'org-cfg'
const UNIT = 'unit-1'
const TS = '2026-06-01T12:00:00.000Z'

const path = (table: string, id: string) => `orgs/${ORG}/${table}/${id}`

async function seedOrg(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$2,$2,1,'Org','slug','barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${ORG}`, ORG],
  )
}

// The unit-scoped config rows (agenda_block, goal, notification) carry the
// `unit_id` FK (brief 0068 D2 → units(org_id,id)); seed the parent unit so those
// projection writes satisfy the FK.
async function seedUnit(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,$3,1,'Unit','unit-'||$3,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${ORG}/units/${UNIT}`, ORG, UNIT],
  )
}

async function rowCount(table: string, aggregatePath: string): Promise<number> {
  const res = await getEventStorePool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE aggregate_path = $1`,
    [aggregatePath],
  )
  return res.rows[0]?.n ?? 0
}

async function genericCount(aggregatePath: string): Promise<number> {
  return rowCount('projections', aggregatePath)
}

const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runPromise(eff)

// ── Domain fixtures (the create-event `data` payloads) ───────────────────────

function category(id: string): Category {
  return {
    id,
    orgId: ORG,
    name: 'Corte',
    icon: null,
    color: null,
    active: true,
    archivedAt: null,
    createdAt: TS,
    updatedAt: TS,
  }
}

function plan(id: string): SubscriptionPlan {
  return {
    id,
    orgId: ORG,
    name: 'Plano Mensal',
    description: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: [],
    includedCategoryIds: [],
    usageLimit: { kind: 'count', quantity: 4 },
    active: true,
    archivedAt: null,
    createdAt: TS,
    updatedAt: TS,
  }
}

function professional(id: string): StoredProfessional {
  return {
    id,
    orgId: ORG,
    userId: `user-${id}`,
    defaultCommission: { kind: 'percentage', value: 50 },
    unitIds: [UNIT],
    catalogServiceIds: [],
    createdAt: TS,
    updatedAt: TS,
  }
}

function customer(id: string): StoredCustomer {
  return {
    id,
    orgId: ORG,
    userId: `user-${id}`,
    archivedAt: null,
    deactivatedAt: null,
    createdAt: TS,
    updatedAt: TS,
  }
}

function invite(id: string): StoredInvite {
  return {
    id,
    orgId: ORG,
    role: 'professional',
    tokenHash: 'hash',
    expiresAt: TS,
    status: 'pending',
    invitedBy: 'owner',
    acceptedByUid: null,
    acceptedAt: null,
    createdAt: TS,
    updatedAt: TS,
  }
}

function agendaBlock(id: string): AgendaBlock {
  return {
    id,
    orgId: ORG,
    unitId: UNIT,
    professionalId: null,
    reason: 'Almoço',
    kind: 'recurring',
    weekday: 'monday',
    open: '12:00',
    close: '13:00',
    startAt: null,
    endAt: null,
    createdAt: TS,
    updatedAt: TS,
  }
}

function goal(id: string): Goal {
  return {
    id,
    orgId: ORG,
    unitId: UNIT,
    period: '2026-06',
    type: 'profit',
    targetCents: 500000,
    createdAt: TS,
    updatedAt: TS,
  }
}

// Each entry drives a real create through the event store and names its typed
// table + create tag + payload (mirrors what the runtime + projector produce).
// `create` provides the Postgres layer and returns a Promise so the
// heterogeneous per-aggregate event tags never have to unify into one Effect.
const CREATES: ReadonlyArray<{ table: string; id: string; create: (id: string) => Promise<void> }> =
  [
    {
      table: 'categories',
      id: 'cat-1',
      create: (id) =>
        run(
          appendEvent(CategoryConfig, path('categories', id), {
            _tag: 'category.created',
            actorId: 'test',
            payload: { data: category(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'subscription_plans',
      id: 'plan-1',
      create: (id) =>
        run(
          appendEvent(SubscriptionPlanConfig, path('subscription_plans', id), {
            _tag: 'subscription_plan.created',
            actorId: 'test',
            payload: { data: plan(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'professionals',
      id: 'pro-1',
      create: (id) =>
        run(
          appendEvent(ProfessionalConfig, path('professionals', id), {
            _tag: 'professional.created',
            actorId: 'test',
            payload: { data: professional(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'customers',
      id: 'cust-1',
      create: (id) =>
        run(
          appendEvent(CustomerConfig, path('customers', id), {
            _tag: 'customer.created',
            actorId: 'test',
            payload: { data: customer(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'invites',
      id: 'inv-1',
      create: (id) =>
        run(
          appendEvent(InviteConfig, path('invites', id), {
            _tag: 'invite.created',
            actorId: 'test',
            payload: { data: invite(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'agenda_blocks',
      id: 'blk-1',
      create: (id) =>
        run(
          appendEvent(AgendaBlockConfig, path('agenda_blocks', id), {
            _tag: 'agenda_block.created',
            actorId: 'test',
            payload: { data: agendaBlock(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'goals',
      id: 'goal-1',
      create: (id) =>
        run(
          appendEvent(GoalConfig, path('goals', id), {
            _tag: 'goal.defined',
            actorId: 'test',
            payload: { data: goal(id) },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
    {
      table: 'notifications',
      id: 'ntf-1',
      // notification.created is a FLAT-payload event (not `{data}`): the fields
      // ride directly on the event (orgId/unitId/type/source/eventKey/…).
      create: (id) =>
        run(
          appendEvent(NotificationConfig, path('notifications', id), {
            _tag: 'notification.created',
            actorId: 'test',
            payload: {
              orgId: ORG,
              unitId: UNIT,
              type: 'birthday',
              customerId: null,
              appointmentId: null,
              subscriptionId: null,
              payload: {},
              source: 'cron',
              eventKey: `ek-${id}`,
              validUntil: null,
            },
          }).pipe(Effect.provide(PostgresPersistenceLayer)),
        ).then(() => undefined),
    },
  ]

// Creator by table name — avoids fragile positional indexing into CREATES.
const creatorFor = (table: string): ((id: string) => Promise<void>) => {
  const entry = CREATES.find((c) => c.table === table)
  if (!entry) throw new Error(`no creator for ${table}`)
  return entry.create
}

describe('Postgres typed projections — config (brief 0060, AC-01)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, professionals, customers, invites, categories, subscription_plans, agenda_blocks, goals, notifications, units, orgs CASCADE',
    )
    await seedOrg()
    await seedUnit()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-01: each config aggregate routes its projection to its TYPED table, not the generic store', async () => {
    for (const c of CREATES) {
      await c.create(c.id)
      const p = path(c.table, c.id)
      expect(await rowCount(c.table, p)).toBe(1)
      expect(await genericCount(p)).toBe(0)
    }
  })

  it('AC-01: replay reconstructs identical state for each config aggregate (union bodies round-trip)', async () => {
    await creatorFor('categories')('cat-r')
    const replayedCategory = await run(
      replayAggregate(CategoryConfig, path('categories', 'cat-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedCategory.name).toBe('Corte')
    expect(replayedCategory._version).toBe(1)

    await creatorFor('subscription_plans')('plan-r')
    const replayedPlan = await run(
      replayAggregate(SubscriptionPlanConfig, path('subscription_plans', 'plan-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    // The usageLimit union body round-trips through the JSONB.
    expect(replayedPlan.usageLimit.kind).toBe('count')
    if (replayedPlan.usageLimit.kind === 'count') {
      expect(replayedPlan.usageLimit.quantity).toBe(4)
    }

    await creatorFor('agenda_blocks')('blk-r')
    const replayedBlock = await run(
      replayAggregate(AgendaBlockConfig, path('agenda_blocks', 'blk-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    // The agenda-block kind union body round-trips.
    expect(replayedBlock.kind).toBe('recurring')
    if (replayedBlock.kind === 'recurring') {
      expect(replayedBlock.weekday).toBe('monday')
      expect(replayedBlock.open).toBe('12:00')
    }

    await creatorFor('goals')('goal-r')
    const replayedGoal = await run(
      replayAggregate(GoalConfig, path('goals', 'goal-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedGoal.targetCents).toBe(500000)
    expect(replayedGoal.period).toBe('2026-06')

    await creatorFor('notifications')('ntf-r')
    const replayedNotification = await run(
      replayAggregate(NotificationConfig, path('notifications', 'ntf-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedNotification.type).toBe('birthday')
    expect(replayedNotification.source).toBe('cron')
    expect(replayedNotification.unitId).toBe(UNIT)
  })

  // ── DB constraint refusals — one per family, via a raw write ───────────────
  it('AC-01: the DATABASE refuses an invite with an invalid status (enum CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO invites (aggregate_path, org_id, id, version, role, token_hash, expires_at, status, invited_by, created_at, updated_at)
         VALUES ($1,$2,'x',1,'professional','h','2026-01-01T00:00:00Z','teleported','owner','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [path('invites', 'x'), ORG],
      ),
      // 23514 = check_violation
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a professional with a blank user_id (non-empty CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO professionals (aggregate_path, org_id, id, version, user_id, unit_ids, catalog_service_ids, created_at, updated_at)
         VALUES ($1,$2,'x',1,'   ','[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [path('professionals', 'x'), ORG],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a subscription_plan with an invalid usage_limit_kind (union discriminant CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO subscription_plans (aggregate_path, org_id, id, version, name, price_cents, billing_cycle, active, usage_limit_kind, usage_limit, included_item_ids, included_category_ids, created_at, updated_at)
         VALUES ($1,$2,'x',1,'P',100,'monthly',true,'infinite','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [path('subscription_plans', 'x'), ORG],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a goal with a non-positive target_cents (positive CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO goals (aggregate_path, org_id, id, unit_id, version, period, type, target_cents, created_at, updated_at)
         VALUES ($1,$2,'x',$3,1,'2026-06','profit',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [path('goals', 'x'), ORG, UNIT],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses an agenda_block with an invalid kind (discriminant CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO agenda_blocks (aggregate_path, org_id, id, unit_id, version, kind, block, created_at, updated_at)
         VALUES ($1,$2,'x',$3,1,'sometimes','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [path('agenda_blocks', 'x'), ORG, UNIT],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a category whose org_id has no org (FK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO categories (aggregate_path, org_id, id, version, name, active, created_at, updated_at)
         VALUES ($1,'ghost-org','x',1,'C',true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [`orgs/ghost-org/categories/x`],
      ),
      // 23503 = foreign_key_violation
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('AC-01: a hard-delete drops the typed category row (event history preserved)', async () => {
    await creatorFor('categories')('cat-del')
    expect(await rowCount('categories', path('categories', 'cat-del'))).toBe(1)

    await run(
      appendEvent(CategoryConfig, path('categories', 'cat-del'), {
        _tag: 'category.deleted',
        actorId: 'test',
        payload: {},
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    await deletePostgresProjection(path('categories', 'cat-del'))

    expect(await rowCount('categories', path('categories', 'cat-del'))).toBe(0)
    const events = await getEventStorePool().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      [path('categories', 'cat-del')],
    )
    expect(events.rows[0]?.n).toBe(2)
  })
})
