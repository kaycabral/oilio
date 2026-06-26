import 'server-only'

import { Schema } from 'effect'

// Typed read boundary. A read is validated by decoding the raw row against its
// Effect Schema (the read-model source-of-truth in `src/domain`) — no `raw as T`.
//
// IMPORTANT: `errors: 'all'` so a ParseError lists EVERY mismatching field
// (not fail-fast). `onExcessProperty: 'ignore'` for forward-compat with newer
// fields written by a future deploy.

/**
 * Decode an arbitrary raw value against `schema`. Used at the Postgres read
 * boundary — the Effect `PersistencePort` returns `Record<string, unknown>`
 * rows that must be validated before crossing into typed domain code.
 */
export function decodeAs<A>(schema: Schema.Schema<A>, raw: unknown): A {
  return Schema.decodeUnknownSync(schema, { errors: 'all', onExcessProperty: 'ignore' })(raw)
}
