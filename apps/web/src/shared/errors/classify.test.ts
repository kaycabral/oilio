import { classifyError } from '@/shared/errors/classify'
import { ERROR_MESSAGES, messageForCategory } from '@/shared/errors/messages'
import * as Cause from 'effect/Cause'
import { describe, expect, it } from 'vitest'

// Shape a pg `DatabaseError`-like object (carries `code` + optional `constraint`),
// as the classifier inspects it via `unwrapPgError`.
function pgError(code: string, constraint?: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code, constraint })
}

// A pg error that surfaces through the Effect runtime is parked under a
// `FiberFailure` — the object exposes the `Cause` under the private symbol the
// unwrapper follows. This mirrors the real saga-path defect shape.
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')
function fiberWrapped(err: Error): unknown {
  return { [FIBER_FAILURE_CAUSE]: Cause.die(err) }
}

describe('classifyError', () => {
  it('classifies a 23505 unique violation as conflict (retriable)', () => {
    expect(classifyError(pgError('23505'))).toBe('conflict')
  })

  it('classifies a 23503 FK violation as integrity', () => {
    expect(classifyError(pgError('23503'))).toBe('integrity')
  })

  it('classifies a 23514 CHECK violation as integrity', () => {
    expect(classifyError(pgError('23514'))).toBe('integrity')
  })

  it('classifies a 42501 RLS refusal as forbidden', () => {
    expect(classifyError(pgError('42501'))).toBe('forbidden')
  })

  it('classifies an unrecognised SQLSTATE as unknown', () => {
    expect(classifyError(pgError('08006'))).toBe('unknown')
  })

  it('classifies a non-pg value (no SQLSTATE) as unknown', () => {
    expect(classifyError(new Error('boom'))).toBe('unknown')
    expect(classifyError('a string')).toBe('unknown')
    expect(classifyError(null)).toBe('unknown')
  })

  it('unwraps a FiberFailure-parked pg error (the saga path)', () => {
    expect(classifyError(fiberWrapped(pgError('23503')))).toBe('integrity')
    expect(classifyError(fiberWrapped(pgError('42501')))).toBe('forbidden')
  })
})

describe('ERROR_MESSAGES', () => {
  it('has a message for every category', () => {
    for (const category of [
      'conflict',
      'integrity',
      'forbidden',
      'validation',
      'unknown',
    ] as const) {
      expect(messageForCategory(category)).toBe(ERROR_MESSAGES[category])
      expect(messageForCategory(category).length).toBeGreaterThan(0)
    }
  })

  it('never carries a SQLSTATE, constraint name, stack or event tag', () => {
    for (const msg of Object.values(ERROR_MESSAGES)) {
      // No 5-char SQLSTATE codes, no "constraint"/"event"/"schema" technical leak.
      expect(msg).not.toMatch(/\b\d{5}\b/)
      expect(msg).not.toMatch(/constraint|sqlstate|violation|event '|_tag/i)
    }
  })

  it('only the conflict message invites a retry ("de novo")', () => {
    expect(ERROR_MESSAGES.conflict).toMatch(/de novo/i)
    // integrity is deterministic — must NOT say "tente de novo".
    expect(ERROR_MESSAGES.integrity).not.toMatch(/de novo/i)
  })
})
