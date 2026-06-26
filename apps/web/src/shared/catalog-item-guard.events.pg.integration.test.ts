import { CatalogItem, type CatalogServiceItem } from '@/domain'
import { CatalogItemConfig } from '@/domain/aggregates'
import { appendEvent, type AggregateConfig, type GuardReader } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { emitEventGuarded } from '@/shared/effect-bridge'
import { Effect, Schema } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Atomic use-time guard (brief 0033 AC-08/AC-09) against REAL Postgres — the
 * cutover rewrite of the old Firestore-emulator `effect-bridge.integration.test`.
 *
 * `emitEventGuarded` resolves the appended event's payload from a transactional
 * read of a definition (a real `catalog_items` projection) INSIDE the SAME
 * Postgres tx that appends the event + projection. The guard:
 *   - rejects when the definition is discontinued (`archivedAt`/`!active`) →
 *     `GuardRejectedError`, mapped to `{ ok:false }` by the bridge;
 *   - snapshots the price as `min(displayed, current)` (CDC art. 30 + Decreto
 *     5.903/2006 art. 5º — never charge more than displayed);
 *   - serializes against a concurrent discontinuation/reprice — the price the
 *     guard snapshots is always lawful (≤ displayed), whatever the commit order.
 *
 * A synthetic `ticket` aggregate (generic `projections` store) keeps the test on
 * the GUARD mechanism #1112 adds — the price-bearing snapshot — exactly as the
 * old synthetic-aggregate test did; the real order/subscription reducers are
 * covered by their own replay suites. The definition it reads is a REAL
 * `catalog_items` projection, created through the event store, so the guard's
 * `reader.getDoc(path, CatalogItem)` exercises the production read path verbatim
 * (mirrors `orders.actions` `addItemToOrder`).
 *
 * globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
 * database (docker locally, services:postgres in CI).
 */

const ORG = 'org-guard'

// ── Synthetic ticket aggregate: its `priceCents` is snapshotted from a real
//    catalog-item definition at append-time (mirrors order-item create).
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

const TicketConfig: AggregateConfig<TicketState, TicketEvent> = {
  type: 'tickets',
  initialState: { _version: 0, priceCents: 0, defId: '' },
  reducer: (_state, event, meta) => ({
    _version: meta.version,
    priceCents: event.priceCents,
    defId: event.defId,
  }),
  schema: TicketEventSchema,
  currentSchemaVersion: 1,
}

const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runPromise(eff)

async function seedOrg(): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$2,$2,1,'Org','slug','barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [`orgs/${ORG}`, ORG],
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
    unitIds: [],
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

const defPath = (id: string) => `orgs/${ORG}/catalog_items/${id}`
const ticketPath = (id: string) => `orgs/${ORG}/tickets/${id}`

async function createDef(
  id: string,
  priceCents: number,
  opts: { active?: boolean; archived?: boolean } = {},
): Promise<void> {
  await run(
    appendEvent(CatalogItemConfig, defPath(id), {
      _tag: 'catalog_item.created',
      actorId: 'test',
      payload: { data: serviceDef(id, priceCents, opts) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function reprice(id: string, priceCents: number): Promise<void> {
  await run(
    appendEvent(CatalogItemConfig, defPath(id), {
      _tag: 'catalog_item.updated',
      actorId: 'test',
      payload: { changes: { priceCents } },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function archive(id: string): Promise<void> {
  await run(
    appendEvent(CatalogItemConfig, defPath(id), {
      _tag: 'catalog_item.archived',
      actorId: 'test',
      payload: { archivedAt: new Date().toISOString() },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

// The guard both `addItemToOrder` and `subscribe` reuse: read the definition
// transactionally, reject when discontinued, snapshot `min(displayed, current)`.
function runGuard(defId: string, ticketId: string, displayed: number | null) {
  return emitEventGuarded<TicketState, TicketEvent>({
    config: TicketConfig,
    aggregatePath: ticketPath(ticketId),
    actorId: 'tester',
    tag: 'ticket.created',
    guard: (reader: GuardReader) =>
      Effect.gen(function* () {
        const item = yield* reader.getDoc(defPath(defId), CatalogItem)
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
  const res = await getEventStorePool().query<{ state: { priceCents: number } }>(
    'SELECT state FROM projections WHERE aggregate_path = $1',
    [ticketPath(ticketId)],
  )
  return res.rows[0]?.state.priceCents ?? null
}

describe('emitEventGuarded — atomic discontinuation + lawful price on Postgres (AC-08/AC-09)', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE events, projections, catalog_items, orgs CASCADE')
    await seedOrg()
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
    // Displayed 5000, but the live price is 8000 → charge the lower (displayed).
    await createDef('d1', 8000)
    const res = await runGuard('d1', 'k1', 5000)
    expect(res.ok).toBe(true)
    expect(await ticketPrice('k1')).toBe(5000)
  })

  it('charges the current price when it dropped below the displayed price', async () => {
    // Displayed 5000, but the live price dropped to 3000 → charge the lower (current).
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
    // Discontinue first, THEN fire many appends — all must reject.
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
    // The price the guard reads inside the tx is whatever is committed at read
    // time; whether the reprice (down to 3000) lands before or after each append,
    // min(displayed=5000, current) is NEVER above the displayed price. The
    // anti-undercharge invariant holds regardless of the commit order.
    await createDef('d1', 5000)
    const results = await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => runGuard('d1', `k${i}`, 5000)),
      reprice('d1', 3000).then(() => null),
    ])
    expect(results).toHaveLength(7)
    for (let i = 0; i < 6; i += 1) {
      const price = await ticketPrice(`k${i}`)
      // a version clash rolled one back — never undercharges, never overcharges.
      if (price === null) continue
      expect(price).toBeLessThanOrEqual(5000)
      expect([3000, 5000]).toContain(price)
    }
  }, 30_000)
})
