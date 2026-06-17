import 'server-only'

import { Schema } from 'effect'
import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'

// Typed Firestore read boundary. A read is validated by decoding the raw doc
// against its Effect Schema (the read-model source-of-truth in `src/domain`)
// — no `raw as T`.
//
// IMPORTANT: `errors: 'all'` so a ParseError lists EVERY mismatching field
// (not fail-fast). `onExcessProperty: 'ignore'` for forward-compat with newer
// fields written by a future deploy.

/**
 * Build a `FirestoreDataConverter` that decodes each snapshot against `schema`.
 * Attach via `ref.withConverter(fsConverter(SchemaForX))`; then `snap.data()`
 * is typed `A` and validated.
 */
export function fsConverter<A extends DocumentData>(
  schema: Schema.Schema<A>,
): FirestoreDataConverter<A> {
  const decode = Schema.decodeUnknownSync(schema, { errors: 'all', onExcessProperty: 'ignore' })
  return {
    toFirestore: (data) => data,
    fromFirestore: (snap: QueryDocumentSnapshot) => decode(snap.data()),
  }
}

/**
 * Decode an arbitrary raw value against `schema`. Use where a converter can't
 * be attached to a ref — `db.getAll(...)` (which drops a ref's converter) and
 * the Effect `FirestoreService` (which returns `Record<string, unknown>`).
 */
export function decodeAs<A>(schema: Schema.Schema<A>, raw: unknown): A {
  return Schema.decodeUnknownSync(schema, { errors: 'all', onExcessProperty: 'ignore' })(raw)
}
