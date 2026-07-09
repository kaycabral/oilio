import type {
  AggregateRef,
  CollectionRef,
  FirestoreDoc,
  PersistenceOps,
  QueryConstraint,
  TransactionContext,
} from '@/domain/effect'
import { PersistencePort, SecurityContext } from '@/domain/effect'
import { competenceOf } from '@/domain/utils/event-competence'
import { Effect, Layer, Option } from 'effect'
import type { PoolClient } from 'pg'
import { setRlsGucs } from '../guc'
import { getEventStorePool } from '../pool'
import { readUnderRls } from '../rls-read'
import './agenda-block-projector'
import './appointment-projector'
import './cash-movement-projector'
import './catalog-item-projector'
import './category-projector'
import './charge-projector'
import './commission-projector'
import './customer-projector'
import './goal-projector'
import './invite-projector'
import './member-operation-projector'
import './membership-projector'
import './notification-projector'
import './order-projector'
import './org-billing-projector'
import './org-projector'
import './subscription-plan-projector'
import './subscription-projector'
import { typedProjectorFor } from './typed-projections'
import './unit-projector'

async function getProjectionDoc(
  client: PoolClient,
  ref: AggregateRef,
): Promise<FirestoreDoc | null> {
  const typed = typedProjectorFor(ref.type)
  if (typed) {
    return typed.read(client, ref)
  }
  const res = await client.query<{ state: FirestoreDoc }>(
    'SELECT state FROM projections WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.state ?? null
}

async function getProjectionDocForUpdate(
  client: PoolClient,
  ref: AggregateRef,
): Promise<FirestoreDoc | null> {
  const typed = typedProjectorFor(ref.type)
  if (typed?.readForUpdate) {
    return typed.readForUpdate(client, ref)
  }
  const res = await client.query<{ state: FirestoreDoc }>(
    'SELECT state FROM projections WHERE org_id = $1 AND id = $2 FOR UPDATE',
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.state ?? null
}

async function readCollection(
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<readonly FirestoreDoc[]> {
  const projector = typedProjectorFor(ref.type)
  if (!projector?.list) {
    throw new Error(`Unsupported collection read for "${ref.type}" (no typed list projector)`)
  }
  const list = projector.list
  return readUnderRls(ref.orgId, (client) => list(client, ref, constraints))
}

async function readEventStream(
  client: PoolClient,
  ref: AggregateRef,
): Promise<readonly FirestoreDoc[]> {
  const res = await client.query<{ envelope: FirestoreDoc }>(
    `SELECT envelope FROM events
     WHERE aggregate_type = $1 AND org_id = $2 AND aggregate_id = $3
     ORDER BY version ASC`,
    [ref.type, ref.orgId, ref.id],
  )
  return res.rows.map((row) => row.envelope)
}

async function writeEvent(
  client: PoolClient,
  ref: AggregateRef,
  version: number,
  envelope: FirestoreDoc,
): Promise<void> {
  const rawTag = envelope['_tag']
  const tag = typeof rawTag === 'string' ? rawTag : ''
  const rawPayload = envelope['payload']
  const payload: Record<string, unknown> =
    rawPayload !== null && typeof rawPayload === 'object' ? { ...rawPayload } : {}
  const occurredAt = competenceOf(tag, payload)

  await client.query(
    `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ref.type, ref.id, version, ref.orgId, envelope, occurredAt],
  )
}

async function upsertProjection(
  client: PoolClient,
  ref: AggregateRef,
  state: FirestoreDoc,
): Promise<void> {
  const typed = typedProjectorFor(ref.type)
  if (typed) {
    await typed.upsert(client, ref, state)
    return
  }
  await client.query(
    `INSERT INTO projections (org_id, id, state, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (org_id, id)
     DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [ref.orgId, ref.id, state],
  )
}

export async function deleteProjectionRow(client: PoolClient, ref: AggregateRef): Promise<void> {
  const typed = typedProjectorFor(ref.type)
  if (typed) {
    await typed.delete(client, ref)
    return
  }
  await client.query('DELETE FROM projections WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

const postgresOps: PersistenceOps = {
  getDoc: (ref: AggregateRef) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        return await getProjectionDoc(client, ref)
      } finally {
        client.release()
      }
    }),

  getDocs: (ref: CollectionRef, constraints?: readonly QueryConstraint[]) =>
    Effect.promise(async () => readCollection(ref, constraints ?? [])),

  getEvents: (ref: AggregateRef) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        return await readEventStream(client, ref)
      } finally {
        client.release()
      }
    }),

  setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        await upsertProjection(client, ref, data)
      } finally {
        client.release()
      }
    }),

  runTransaction: <A, E>(fn: (tx: TransactionContext) => Effect.Effect<A, E, never>) =>
    Effect.serviceOption(SecurityContext).pipe(
      Effect.flatMap((ctx) =>
        Effect.promise(async () => {
          const security = Option.getOrNull(ctx)
          const pool = getEventStorePool()
          const client = await pool.connect()
          let rlsSet = false
          const ensureRls = async (orgId: string | null): Promise<void> => {
            if (rlsSet) return
            const resolvedOrg = security?.orgId ?? orgId
            await setRlsGucs(
              client,
              resolvedOrg,
              security?.unitId ?? '',
              security?.memberOperationId ?? '',
            )
            if (resolvedOrg !== null) rlsSet = true
          }
          try {
            await client.query('BEGIN')
            const txCtx: TransactionContext = {
              getDoc: (ref: AggregateRef) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return getProjectionDoc(client, ref)
                }),
              getDocForUpdate: (ref: AggregateRef) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return getProjectionDocForUpdate(client, ref)
                }),
              setDoc: (ref: AggregateRef, d: FirestoreDoc) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return upsertProjection(client, ref, d)
                }),
              appendEvent: (ref: AggregateRef, version: number, envelope: FirestoreDoc) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return writeEvent(client, ref, version, envelope)
                }),
              deleteDoc: (ref: AggregateRef) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return deleteProjectionRow(client, ref)
                }),
            }
            const result = await Effect.runPromise(fn(txCtx))
            await client.query('COMMIT')
            return result
          } catch (err) {
            await client.query('ROLLBACK')
            throw err
          } finally {
            client.release()
          }
        }),
      ),
    ),
}

export const PostgresPersistenceLayer = Layer.succeed(PersistencePort, postgresOps)

export const PostgresLayerLive = PostgresPersistenceLayer

export async function deletePostgresProjection(ref: AggregateRef): Promise<void> {
  const pool = getEventStorePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setRlsGucs(client, ref.orgId, '')
    await deleteProjectionRow(client, ref)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
