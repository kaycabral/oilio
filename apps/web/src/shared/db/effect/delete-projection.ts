import { deletePostgresProjection } from '@/shared/db/pg/effect/postgres-layer'
import 'server-only'

/**
 * Hard-delete of an org-scoped projection doc (brief 0058, AC-02).
 *
 * A `*.deleted` event is appended through the `PersistencePort` (history kept),
 * but the event store skips the projection write for `*.deleted` — the caller
 * hard-deletes the read-model row, or it would be orphaned.
 *
 * It is deliberately NOT a `PersistencePort` method: delete is a read-model
 * concern, and the port (the event-store seam) must not reopen for it (brief
 * 0058, AC-03).
 *
 * `aggregatePath` is the path (`orgs/{orgId}/{collection}/{id}`) — the same key
 * the typed projector and the generic store use.
 */
export async function deleteOrgProjectionDoc(
  orgId: string,
  collection: string,
  docId: string,
): Promise<void> {
  await deletePostgresProjection(`orgs/${orgId}/${collection}/${docId}`)
}
