import * as Cause from 'effect/Cause'

const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

export type PgErrorShape = {
  readonly code?: string
  readonly constraint?: string
}

const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/

export function unwrapPgError(err: unknown): PgErrorShape {
  let current: unknown = err
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const { code, constraint } = current as { code?: unknown; constraint?: unknown }
    if (typeof code === 'string' && SQLSTATE_SHAPE.test(code)) {
      return {
        code,
        constraint: typeof constraint === 'string' ? constraint : undefined,
      }
    }
    const parked = (current as { [FIBER_FAILURE_CAUSE]?: unknown })[FIBER_FAILURE_CAUSE]
    if (Cause.isCause(parked)) {
      current = Cause.squash(parked)
      continue
    }
    current = (current as { cause?: unknown }).cause
  }
  return {}
}
