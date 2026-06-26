import { randomUUID } from 'node:crypto'
import 'server-only'

/**
 * Mint a new aggregate/document id (migration feature F — cutover, brief 0062).
 *
 * Pre-cutover the codebase minted ids by allocating an empty Firestore doc ref
 * (`getAdminFirestore().collection(...).doc().id`) — a Firestore-coupled trick
 * that the cutover removes. Post-cutover ids are generated locally with a UUIDv4,
 * which is collision-free, opaque, and backend-agnostic (Postgres keys are TEXT,
 * so a UUID string slots in wherever the Firestore auto-id did).
 *
 * Server-only: id minting happens in server actions / sagas, never the client.
 */
export function newId(): string {
  return randomUUID()
}
