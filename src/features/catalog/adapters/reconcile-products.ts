import { CatalogItemConfig } from '@/domain/aggregates'
import type { EventValidationError } from '@/domain/effect'
import { aggregateRef, appendEvent, collectionRef, PersistencePort } from '@/domain/effect'
import { listAllOrgIds } from '@/shared/db/pg/public-org-directory'
import { resolveGate } from '@/shared/product'
import { Effect, Option, Schema } from 'effect'

const PendingItemDoc = Schema.Struct({
  id: Schema.String,
  gtin14: Schema.NullOr(Schema.String),
})

export function reconcilePendingProducts(
  now: Date = new Date(),
): Effect.Effect<number, never, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    const orgIds = yield* Effect.promise(() => listAllOrgIds())
    let reconciled = 0

    for (const orgId of orgIds) {
      if (!orgId) continue

      const pendingDocs = yield* persistence.getDocs(collectionRef(CatalogItemConfig, orgId), [
        { kind: 'where', field: 'reconciliationPending', op: '==', value: true },
      ])

      for (const raw of pendingDocs) {
        const ok = yield* reconcileOne(orgId, raw, now)
        if (ok) reconciled++
      }
    }

    return reconciled
  })
}

function reconcileOne(
  orgId: string,
  raw: unknown,
  now: Date,
): Effect.Effect<boolean, never, PersistencePort> {
  return Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(PendingItemDoc)(raw)
    if (Option.isNone(decoded) || !decoded.value.id) return false
    const item = decoded.value

    if (!item.gtin14) {
      yield* clearMarker(orgId, item.id, null, now)
      return true
    }

    const outcome = yield* Effect.promise(() => resolveGate(item.gtin14 ?? '').catch(() => null))
    if (outcome === null) return false

    const resolvedGtin = outcome.kind === 'skipped' ? item.gtin14 : outcome.gtin14
    yield* clearMarker(orgId, item.id, resolvedGtin, now)
    return true
  }).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.catchAllDefect(() => Effect.succeed(false)),
  )
}

function clearMarker(
  orgId: string,
  itemId: string,
  gtin14: string | null,
  now: Date,
): Effect.Effect<void, EventValidationError, PersistencePort> {
  return appendEvent(CatalogItemConfig, aggregateRef(CatalogItemConfig, orgId, itemId), {
    _tag: 'catalog_item.updated',
    actorId: 'system:cron-reconcile',
    payload: {
      changes: {
        gtin14,
        reconciliationPending: false,
        reconciliationLastAttempt: now.toISOString(),
      },
    },
  }).pipe(Effect.asVoid)
}
