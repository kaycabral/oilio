import { CatalogItem, type CatalogServiceItem } from '@/domain'
import { CatalogItemConfig } from '@/domain/aggregates'
import {
  aggregateRef,
  appendEvent,
  type AggregateConfig,
  type AggregateRef,
  type GuardReader,
  type StoredDoc,
} from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { registerTypedProjector } from '@/shared/db/pg/effect/typed-projections'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { emitEventGuarded } from '@/shared/effect-bridge'
import { Effect, Schema } from 'effect'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ORG = 'org-guard'

type TicketState = {
  readonly _version: number
  readonly priceCents: number
  readonly defId: string
}

const TicketEventSchema = Schema.Struct({
  _tag: Schema.Literal('ticket.created'),
  priceCents: Schema.Number,
  defId: Schema.String,
})
type TicketEvent = Schema.Schema.Type<typeof TicketEventSchema>

const TICKET_TYPE = 'goal' as const

const TicketConfig: AggregateConfig<TicketState, TicketEvent> = {
  type: TICKET_TYPE,
  initialState: { _version: 0, priceCents: 0, defId: '' },
  reducer: (_state, event, meta) => ({
    _version: meta.version,
    priceCents: event.priceCents,
    defId: event.defId,
  }),
  schema: TicketEventSchema,
  currentSchemaVersion: 1,
}

async function readGenericProjection(
  client: PoolClient,
  ref: AggregateRef,
): Promise<StoredDoc | null> {
  const res = await client.query<{ state: StoredDoc }>(
    'SELECT state FROM projections WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.state ?? null
}

function registerGenericTicketProjector(): void {
  registerTypedProjector(TICKET_TYPE, {
    read: readGenericProjection,
    readForUpdate: async (client, ref) => {
      const res = await client.query<{ state: StoredDoc }>(
        'SELECT state FROM projections WHERE org_id = $1 AND id = $2 FOR UPDATE',
        [ref.orgId, ref.id],
      )
      return res.rows[0]?.state ?? null
    },
    upsert: async (client, ref, state) => {
      await client.query(
        `INSERT INTO projections (org_id, id, state, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (org_id, id)
         DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [ref.orgId, ref.id, state],
      )
    },
    delete: async (client, ref) => {
      await client.query('DELETE FROM projections WHERE org_id = $1 AND id = $2', [
        ref.orgId,
        ref.id,
      ])
    },
  })
}

const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runPromise(eff)

async function seedOrgAndUnit(): Promise<void> {
  const pool = ownerPool()
  await pool.query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug','barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,'unit-seed',1,'Unit','unit-seed','America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
}

function serviceDef(
  id: string,
  priceCents: number,
  opts: { active?: boolean; archived?: boolean } = {},
): CatalogServiceItem {
  return {
    id,
    orgId: ORG,
    name: 'Corte',
    categoryId: null,
    priceCents,
    commission: null,
    unitIds: ['unit-seed'],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: opts.active ?? true,
    archivedAt: opts.archived ? '2026-06-01T12:00:00.000Z' : null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    kind: 'service',
    durationMinutes: 30,
    requiredResources: [],
  }
}

const defRef = (id: string) => aggregateRef(CatalogItemConfig, ORG, id)
const ticketRef = (id: string) => aggregateRef(TicketConfig, ORG, id)

async function createDef(
  id: string,
  priceCents: number,
  opts: { active?: boolean; archived?: boolean } = {},
): Promise<void> {
  await run(
    appendEvent(CatalogItemConfig, defRef(id), {
      _tag: 'catalog_item.created',
      actorId: 'test',
      payload: { data: serviceDef(id, priceCents, opts) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function reprice(id: string, priceCents: number): Promise<void> {
  await run(
    appendEvent(CatalogItemConfig, defRef(id), {
      _tag: 'catalog_item.updated',
      actorId: 'test',
      payload: { changes: { priceCents } },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function archive(id: string): Promise<void> {
  await run(
    appendEvent(CatalogItemConfig, defRef(id), {
      _tag: 'catalog_item.archived',
      actorId: 'test',
      payload: { archivedAt: new Date().toISOString() },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

function runGuard(defId: string, ticketId: string, displayed: number | null) {
  return emitEventGuarded<TicketState, TicketEvent>({
    config: TicketConfig,
    ref: ticketRef(ticketId),
    actorId: 'tester',
    tag: 'ticket.created',
    guard: (reader: GuardReader) =>
      Effect.gen(function* () {
        const item = yield* reader.getDoc(defRef(defId), CatalogItem)
        if (!item) return { _tag: 'reject' as const, message: 'definição não encontrada' }
        if (!item.active || item.archivedAt) {
          return { _tag: 'reject' as const, message: 'descontinuado' }
        }
        const priceCents =
          displayed === null ? item.priceCents : Math.min(displayed, item.priceCents)
        return { _tag: 'ok' as const, payload: { priceCents, defId: item.id } }
      }),
  })
}

async function ticketPrice(ticketId: string): Promise<number | null> {
  const res = await ownerPool().query<{ state: { priceCents: number } }>(
    'SELECT state FROM projections WHERE org_id = $1 AND id = $2',
    [ORG, ticketId],
  )
  return res.rows[0]?.state.priceCents ?? null
}

describe('emitEventGuarded — atomic discontinuation + lawful price on Postgres (AC-08/AC-09)', () => {
  beforeAll(() => {
    registerGenericTicketProjector()
  })

  beforeEach(async () => {
    await ownerPool().query(
      'TRUNCATE events, projections, catalog_item_units, catalog_items, units, orgs CASCADE',
    )
    await seedOrgAndUnit()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('rejects when the definition is discontinued (archived) and writes nothing', async () => {
    await createDef('d1', 5000, { archived: true })
    const res = await runGuard('d1', 'k1', 5000)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('descontinuado')
    expect(await ticketPrice('k1')).toBeNull()
  })

  it('rejects when the definition is inactive (active=false)', async () => {
    await createDef('d1', 5000, { active: false })
    const res = await runGuard('d1', 'k1', 5000)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('descontinuado')
    expect(await ticketPrice('k1')).toBeNull()
  })

  it('charges the displayed price when the current price rose between display and commit', async () => {
    await createDef('d1', 8000)
    const res = await runGuard('d1', 'k1', 5000)
    expect(res.ok).toBe(true)
    expect(await ticketPrice('k1')).toBe(5000)
  })

  it('charges the current price when it dropped below the displayed price', async () => {
    await createDef('d1', 3000)
    const res = await runGuard('d1', 'k1', 5000)
    expect(res.ok).toBe(true)
    expect(await ticketPrice('k1')).toBe(3000)
  })

  it('charges the current price when no displayed price is threaded', async () => {
    await createDef('d1', 4200)
    const res = await runGuard('d1', 'k1', null)
    expect(res.ok).toBe(true)
    expect(await ticketPrice('k1')).toBe(4200)
  })

  it('a discontinuation committed BEFORE the appends rejects every one (no stale add)', async () => {
    await createDef('d1', 5000)
    await archive('d1')

    const appends = await Promise.all(
      Array.from({ length: 8 }, (_, i) => runGuard('d1', `k${i}`, 5000)),
    )
    expect(appends.every((r) => !r.ok)).toBe(true)
    for (const r of appends) {
      if (r.ok) continue
      expect(r.error).toBe('descontinuado')
    }
  }, 30_000)

  it('the snapshotted price is always lawful (≤ displayed) under a concurrent reprice', async () => {
    await createDef('d1', 5000)
    const results = await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => runGuard('d1', `k${i}`, 5000)),
      reprice('d1', 3000).then(() => null),
    ])
    expect(results).toHaveLength(7)
    for (let i = 0; i < 6; i += 1) {
      const price = await ticketPrice(`k${i}`)
      if (price === null) continue
      expect(price).toBeLessThanOrEqual(5000)
      expect([3000, 5000]).toContain(price)
    }
  }, 30_000)
})
