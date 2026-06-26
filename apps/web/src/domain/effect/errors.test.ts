import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { AppointmentConflictError, PlanNotActiveError } from './errors'

describe('DomainError tagged errors', () => {
  it('AppointmentConflictError is catchable by tag', async () => {
    const program = Effect.gen(function* () {
      return yield* Effect.fail(
        new AppointmentConflictError({
          professionalId: 'prof-1',
          proposedStart: '2026-06-01T10:00:00Z',
          proposedEnd: '2026-06-01T11:00:00Z',
          conflictingIds: ['apt-99'],
        }),
      )
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.catchTag('AppointmentConflictError', (e) =>
          Effect.succeed({ caught: true, ids: e.conflictingIds }),
        ),
      ),
    )

    expect(result).toEqual({ caught: true, ids: ['apt-99'] })
  })

  it('different error tags are not caught by wrong catchTag', async () => {
    const program = Effect.fail<AppointmentConflictError | PlanNotActiveError>(
      new PlanNotActiveError({ subscriptionId: 'sub-1', currentStatus: 'cancelled' }),
    )

    const result = await Effect.runPromise(
      program.pipe(
        Effect.catchTag('AppointmentConflictError', () => Effect.succeed('wrong-catch')),
        Effect.catchTag('PlanNotActiveError', (e) => Effect.succeed(`correct: ${e.currentStatus}`)),
      ),
    )

    expect(result).toBe('correct: cancelled')
  })

  it('errors carry discriminated _tag field', () => {
    const error = new AppointmentConflictError({
      professionalId: 'prof-1',
      proposedStart: '2026-06-01T10:00:00Z',
      proposedEnd: '2026-06-01T11:00:00Z',
      conflictingIds: [],
    })

    expect(error._tag).toBe('AppointmentConflictError')
  })
})
