import { classifyError } from '@/shared/errors/classify'
import { ERROR_MESSAGES, messageForCategory } from '@/shared/errors/messages'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

function pgError(code: string, constraint?: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code, constraint })
}

function rejectionOf(err: Error): Promise<unknown> {
  return Effect.runPromise(Effect.die(err)).then(
    () => undefined,
    (rejected: unknown) => rejected,
  )
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

  it('classifies a 23P01 exclusion (double-book) violation as integrity, not unknown', () => {
    expect(classifyError(pgError('23P01'))).toBe('integrity')
  })

  it('classifies an unrecognised SQLSTATE as unknown', () => {
    expect(classifyError(pgError('08006'))).toBe('unknown')
  })

  it('does not let a wrapper error with a non-SQLSTATE code shadow the real pg error', () => {
    const wrapped = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      cause: pgError('23505'),
    })
    expect(classifyError(wrapped)).toBe('conflict')
  })

  it('classifies a non-pg value (no SQLSTATE) as unknown', () => {
    expect(classifyError(new Error('boom'))).toBe('unknown')
    expect(classifyError('a string')).toBe('unknown')
    expect(classifyError(null)).toBe('unknown')
  })

  it('classifies the pg defect an Effect run rejects with (the saga path)', async () => {
    expect(classifyError(await rejectionOf(pgError('23503')))).toBe('integrity')
    expect(classifyError(await rejectionOf(pgError('42501')))).toBe('forbidden')
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
      expect(msg).not.toMatch(/\b\d{5}\b/)
      expect(msg).not.toMatch(/constraint|sqlstate|violation|event '|_tag/i)
    }
  })

  it('only the conflict message invites a retry ("de novo")', () => {
    expect(ERROR_MESSAGES.conflict).toMatch(/de novo/i)
    expect(ERROR_MESSAGES.integrity).not.toMatch(/de novo/i)
  })
})
