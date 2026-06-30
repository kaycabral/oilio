import { AgendaBlockConfig } from '@/domain/aggregates/agenda-block/config'
import { CategoryConfig } from '@/domain/aggregates/category/config'
import { CustomerConfig } from '@/domain/aggregates/customer/config'
import { GoalConfig } from '@/domain/aggregates/goal/config'
import { InviteConfig } from '@/domain/aggregates/invite/config'
import { MemberOperationConfig } from '@/domain/aggregates/member-operation/config'
import { NotificationConfig } from '@/domain/aggregates/notification/config'
import { SubscriptionPlanConfig } from '@/domain/aggregates/subscription-plan/config'
import { aggregateRef, type AggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import type { AgendaBlock } from '@/domain/types/agenda-block'
import type { Category } from '@/domain/types/category'
import type { StoredCustomer } from '@/domain/types/customer'
import type { Goal } from '@/domain/types/goal'
import type { StoredInvite } from '@/domain/types/invite'
import type { StoredMemberOperation } from '@/domain/types/member-operation'
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

// table → aggregate config, so a `(table, id)` pair builds the typed ref the
// event store / projector now speak (D6, ADR 0013) — no path string.
const CONFIG_BY_TABLE = {
  categories: CategoryConfig,
  subscription_plans: SubscriptionPlanConfig,
  member_operations: MemberOperationConfig,
  customers: CustomerConfig,
  invites: InviteConfig,
  agenda_blocks: AgendaBlockConfig,
  goals: GoalConfig,
  notifications: NotificationConfig,
} as const

const refOf = (table: keyof typeof CONFIG_BY_TABLE, id: string): AggregateRef =>
  aggregateRef(CONFIG_BY_TABLE[table], ORG, id)

async function seedOrg(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug','barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
}

// The unit-scoped config rows (agenda_block, goal, notification) carry the
// `unit_id` FK (brief 0068 D2 → units(org_id,id)); seed the parent unit so those
// projection writes satisfy the FK.
async function seedUnit(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, UNIT],
  )
}

// The typed projection tables are keyed by composite PK (org_id, id) (D6, ADR
// 0013) — count by the ref's org/id, never a path.
async function rowCount(table: string, ref: AggregateRef): Promise<number> {
  const res = await getEventStorePool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1 AND id = $2`,
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.n ?? 0
}

// The generic JSONB store is keyed by composite PK (org_id, id).
async function genericCount(ref: AggregateRef): Promise<number> {
  const res = await getEventStorePool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM projections WHERE org_id = $1 AND id = $2`,
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.n ?? 0
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

function memberOperation(id: string): StoredMemberOperation {
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
    acquisition: null,
    createdAt: TS,
    updatedAt: TS,
  }
}

function invite(id: string): StoredInvite {
  return {
    id,
    orgId: ORG,
    role: 'member_operator',
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
    memberOperationId: null,
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
const CREATES: ReadonlyArray<{
  table: keyof typeof CONFIG_BY_TABLE
  id: string
  create: (id: string) => Promise<void>
}> = [
  {
    table: 'categories',
    id: 'cat-1',
    create: (id) =>
      run(
        appendEvent(CategoryConfig, refOf('categories', id), {
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
        appendEvent(SubscriptionPlanConfig, refOf('subscription_plans', id), {
          _tag: 'subscription_plan.created',
          actorId: 'test',
          payload: { data: plan(id) },
        }).pipe(Effect.provide(PostgresPersistenceLayer)),
      ).then(() => undefined),
  },
  {
    table: 'member_operations',
    id: 'pro-1',
    create: async (id) => {
      // The operational profile hangs off the membership (brief 0076 AC-02): the
      // projector derives `member_id` as `{ORG}_{userId}` (userId = `user-${id}`)
      // and the composite FK needs this parent.
      await getEventStorePool().query(
        `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
         VALUES ($1,$1||'_user-'||$2,'user-'||$2,1,'member_operator','active',$3,'{}'::jsonb,$3)
         ON CONFLICT (org_id, id) DO NOTHING`,
        [ORG, id, TS],
      )
      await run(
        appendEvent(MemberOperationConfig, refOf('member_operations', id), {
          _tag: 'member_operation.created',
          actorId: 'test',
          payload: { data: memberOperation(id) },
        }).pipe(Effect.provide(PostgresPersistenceLayer)),
      )
    },
  },
  {
    table: 'customers',
    id: 'cust-1',
    create: (id) =>
      run(
        appendEvent(CustomerConfig, refOf('customers', id), {
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
        appendEvent(InviteConfig, refOf('invites', id), {
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
        appendEvent(AgendaBlockConfig, refOf('agenda_blocks', id), {
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
        appendEvent(GoalConfig, refOf('goals', id), {
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
        appendEvent(NotificationConfig, refOf('notifications', id), {
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
const creatorFor = (table: keyof typeof CONFIG_BY_TABLE): ((id: string) => Promise<void>) => {
  const entry = CREATES.find((c) => c.table === table)
  if (!entry) throw new Error(`no creator for ${table}`)
  return entry.create
}

describe('Postgres typed projections — config (brief 0060, AC-01)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, member_operations, memberships, customers, invites, categories, subscription_plans, agenda_blocks, goals, notifications, units, orgs CASCADE',
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
      const ref = refOf(c.table, c.id)
      expect(await rowCount(c.table, ref)).toBe(1)
      expect(await genericCount(ref)).toBe(0)
    }
  })

  it('AC-01: replay reconstructs identical state for each config aggregate (union bodies round-trip)', async () => {
    await creatorFor('categories')('cat-r')
    const replayedCategory = await run(
      replayAggregate(CategoryConfig, refOf('categories', 'cat-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedCategory.name).toBe('Corte')
    expect(replayedCategory._version).toBe(1)

    await creatorFor('subscription_plans')('plan-r')
    const replayedPlan = await run(
      replayAggregate(SubscriptionPlanConfig, refOf('subscription_plans', 'plan-r')).pipe(
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
      replayAggregate(AgendaBlockConfig, refOf('agenda_blocks', 'blk-r')).pipe(
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
      replayAggregate(GoalConfig, refOf('goals', 'goal-r')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedGoal.targetCents).toBe(500000)
    expect(replayedGoal.period).toBe('2026-06')

    await creatorFor('notifications')('ntf-r')
    const replayedNotification = await run(
      replayAggregate(NotificationConfig, refOf('notifications', 'ntf-r')).pipe(
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
        `INSERT INTO invites (org_id, id, last_event_version, role, token_hash, expires_at, status, invited_by, created_at, updated_at)
         VALUES ($1,'x',1,'member_operator','h','2026-01-01T00:00:00Z','teleported','owner','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG],
      ),
      // 23514 = check_violation
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a memberOperation with a blank user_id (non-empty CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, unit_ids, catalog_service_ids, created_at, updated_at)
         VALUES ($1,'x',1,'   ',$1||'_   ','[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a subscription_plan with an invalid usage_limit_kind (union discriminant CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO subscription_plans (org_id, id, last_event_version, name, price_cents, billing_cycle, active, usage_limit_kind, usage_limit, included_item_ids, included_category_ids, created_at, updated_at)
         VALUES ($1,'x',1,'P',100,'monthly',true,'infinite','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a goal with a non-positive target_cents (positive CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO goals (org_id, id, unit_id, last_event_version, period, type, target_cents, created_at, updated_at)
         VALUES ($1,'x',$2,1,'2026-06','profit',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG, UNIT],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses an agenda_block with an invalid kind (discriminant CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO agenda_blocks (org_id, id, unit_id, last_event_version, kind, block, created_at, updated_at)
         VALUES ($1,'x',$2,1,'sometimes','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG, UNIT],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a category whose org_id has no org (FK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO categories (org_id, id, last_event_version, name, active, created_at, updated_at)
         VALUES ('ghost-org','x',1,'C',true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [],
      ),
      // 23503 = foreign_key_violation
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('AC-01: a hard-delete drops the typed category row (event history preserved)', async () => {
    await creatorFor('categories')('cat-del')
    const catDelRef = refOf('categories', 'cat-del')
    expect(await rowCount('categories', catDelRef)).toBe(1)

    await run(
      appendEvent(CategoryConfig, refOf('categories', 'cat-del'), {
        _tag: 'category.deleted',
        actorId: 'test',
        payload: {},
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    await deletePostgresProjection(catDelRef)

    expect(await rowCount('categories', catDelRef)).toBe(0)
    // `events.aggregate_id` is the bare aggregate id (D6) — scoped by org/type.
    const events = await getEventStorePool().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_type = $1 AND org_id = $2 AND aggregate_id = $3',
      [catDelRef.type, catDelRef.orgId, catDelRef.id],
    )
    expect(events.rows[0]?.n).toBe(2)
  })
})
