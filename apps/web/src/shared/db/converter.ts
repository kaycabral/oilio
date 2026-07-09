import 'server-only'

import { Schema } from 'effect'

export function decodeAs<A>(schema: Schema.Schema<A>, raw: unknown): A {
  return Schema.decodeUnknownSync(schema, { errors: 'all', onExcessProperty: 'ignore' })(raw)
}
