// Id minting for the seed.
//
// The app's `@/shared/db/pg/new-id` is `server-only` (id minting belongs in
// server actions / sagas, never the client bundle), so a plain `tsx` script
// can't import it. The seed runs server-side but OUTSIDE the Next bundle, where
// the `server-only` guard doesn't apply — so it mints ids the same way
// (`randomUUID`) without pulling the guarded module. Same primitive, no domain
// logic duplicated.

import { randomUUID } from 'node:crypto'

export function newId(): string {
  return randomUUID()
}
