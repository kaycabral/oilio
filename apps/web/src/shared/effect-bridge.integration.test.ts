// Integration test for the atomic use-time guard (brief 0033 AC-08/AC-09, #1112).
//
// Runs against the Firebase emulator under `firebase emulators:exec` (see
// vitest.integration.config.ts). It exercises `appendEventGuarded` — the
// server-side primitive both `addItemToOrder` (sale) and `subscribe`
// (subscription) reuse to read a definition (catalog-item / plan) INSIDE the
// event-append transaction. The guard:
//   - rejects when the definition is discontinued (`archivedAt`/`!active`),
//   - snapshots the price as `min(displayed, current)` (CDC art. 30 + Decreto
//     5.903/2006 art. 5º — never charge more than displayed),
//   - serializes against a concurrent discontinuation/reprice via Firestore
//     optimistic concurrency (the transactional read locks the definition doc).
//
// A synthetic aggregate config keeps the test focused on the GUARD mechanism
// (the part #1112 adds); the order/subscription reducers are covered by their
// own replay suites. The fixture writes real definition docs and drives real
// transactions through `FirestoreLayerLive` (no Firestore mock — monorepo rule).

import { appendEventGuarded, type AggregateConfig, type GuardReader } from '@/domain/effect'
import { FirestoreLayerLive } from '@/shared/db/effect'
import { Effect, Schema } from 'effect'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// ── Synthetic aggregate: a "ticket" whose `priceCents` is snapshotted from a
//    definition doc at append-time, mirroring order-item / subscription create.
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
  type: 'ticket',
  initialState: { _version: 0, priceCents: 0, defId: '' },
  reducer: (_state, event, meta) => ({
    _version: meta.version,
    priceCents: event.priceCents,
    defId: event.defId,
  }),
  schema: TicketEventSchema,
  currentSchemaVersion: 1,
}

let app: App
let db: Firestore

beforeEach(() => {
  app = getApps()[0] ?? initializeApp({ projectId: 'scheduling-integration-test' })
  db = getFirestore(app)
})

afterAll(async () => {
  // nothing to tear down — emulator data is project-scoped and ephemeral.
})

function uniq(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Builds the guard both actions use: read the definition transactionally, reject
// when discontinued, snapshot `min(displayed, current)`.
const DefSchema = Schema.Struct({
  id: Schema.String,
  active: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.String),
  priceCents: Schema.Number,
})

function priceGuard(defPath: string, displayedPriceCents: number | null) {
  return (reader: GuardReader) =>
    Effect.gen(function* () {
      const doc = yield* reader.getDoc(defPath, DefSchema)
      if (!doc) {
        return { _tag: 'reject' as const, message: 'definição não encontrada' }
      }
      if (!doc.active || doc.archivedAt) {
        return { _tag: 'reject' as const, message: 'descontinuado' }
      }
      const priceCents =
        displayedPriceCents === null
          ? doc.priceCents
          : Math.min(displayedPriceCents, doc.priceCents)
      return { _tag: 'ok' as const, payload: { priceCents, defId: doc.id } }
    })
}

async function runGuard(defPath: string, ticketPath: string, displayed: number | null) {
  return Effect.runPromise(
    appendEventGuarded({
      config: TicketConfig,
      aggregatePath: ticketPath,
      actorId: 'tester',
      tag: 'ticket.created',
      guard: priceGuard(defPath, displayed),
    }).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.provide(FirestoreLayerLive),
    ),
  )
}

describe('appendEventGuarded — atomic discontinuation + lawful price (AC-08/AC-09)', () => {
  it('rejects when the definition is discontinued (archivedAt set)', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    await db
      .doc(defPath)
      .set({ id: 'd1', active: true, archivedAt: new Date().toISOString(), priceCents: 5000 })

    const res = await runGuard(defPath, `tenants/${tenant}/tickets/k1`, 5000)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('descontinuado')
    const written = await db.doc(`tenants/${tenant}/tickets/k1`).get()
    expect(written.exists).toBe(false)
  })

  it('rejects when the definition is inactive (active=false)', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    await db.doc(defPath).set({ id: 'd1', active: false, archivedAt: null, priceCents: 5000 })

    const res = await runGuard(defPath, `tenants/${tenant}/tickets/k1`, 5000)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('descontinuado')
  })

  it('charges the displayed price when the current price rose between display and commit', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    // Displayed 5000, but the live price was raised to 8000 → charge the lower (displayed).
    await db.doc(defPath).set({ id: 'd1', active: true, archivedAt: null, priceCents: 8000 })

    const res = await runGuard(defPath, `tenants/${tenant}/tickets/k1`, 5000)
    expect(res.ok).toBe(true)
    const written = await db.doc(`tenants/${tenant}/tickets/k1`).get()
    expect(written.data()?.priceCents).toBe(5000)
  })

  it('charges the current price when it dropped below the displayed price', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    // Displayed 5000, but the live price dropped to 3000 → charge the lower (current).
    await db.doc(defPath).set({ id: 'd1', active: true, archivedAt: null, priceCents: 3000 })

    const res = await runGuard(defPath, `tenants/${tenant}/tickets/k1`, 5000)
    expect(res.ok).toBe(true)
    const written = await db.doc(`tenants/${tenant}/tickets/k1`).get()
    expect(written.data()?.priceCents).toBe(3000)
  })

  it('charges the current price when no displayed price is threaded', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    await db.doc(defPath).set({ id: 'd1', active: true, archivedAt: null, priceCents: 4200 })

    const res = await runGuard(defPath, `tenants/${tenant}/tickets/k1`, null)
    expect(res.ok).toBe(true)
    const written = await db.doc(`tenants/${tenant}/tickets/k1`).get()
    expect(written.data()?.priceCents).toBe(4200)
  })

  it('closes the TOCTOU race: discontinuation committed mid-flight rejects the append', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    await db.doc(defPath).set({ id: 'd1', active: true, archivedAt: null, priceCents: 5000 })

    // Fire the guarded append and a discontinuation concurrently. Firestore
    // serializes them: either the discontinuation lands first (append re-reads
    // and rejects) or the append lands first (definition still active → ok).
    // Either way the committed state is consistent — never an active ticket
    // against a state the transaction didn't observe.
    const [appendRes] = await Promise.all([
      runGuard(defPath, `tenants/${tenant}/tickets/race`, 5000),
      db.doc(defPath).update({ archivedAt: new Date().toISOString() }),
    ])

    const ticket = await db.doc(`tenants/${tenant}/tickets/race`).get()
    if (appendRes.ok) {
      // Append won the race — it observed the still-active definition.
      expect(ticket.exists).toBe(true)
    } else {
      // Discontinuation won — append re-read fresh state and rejected.
      expect(appendRes.error).toBe('descontinuado')
      expect(ticket.exists).toBe(false)
    }
  })

  it('serializes many concurrent appends against a single discontinuation deterministically', async () => {
    const tenant = uniq('t')
    const defPath = `tenants/${tenant}/defs/d1`
    await db.doc(defPath).set({ id: 'd1', active: true, archivedAt: null, priceCents: 5000 })
    // Discontinue first, THEN fire appends — all must reject (no stale add).
    await db.doc(defPath).update({ archivedAt: new Date().toISOString() })

    const appends = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runGuard(defPath, `tenants/${tenant}/tickets/k${i}`, 5000),
      ),
    )
    expect(appends.every((r) => !r.ok)).toBe(true)
    for (const r of appends) {
      if (r.ok) continue
      expect(r.error).toBe('descontinuado')
    }
  }, 30_000)
})
