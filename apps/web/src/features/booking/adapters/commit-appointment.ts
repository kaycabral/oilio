import type { Appointment } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { securityLayer, type WriteSecurity } from '@/shared/effect-bridge'
import { logger } from '@/shared/lib'
import { Cause, Effect, Layer } from 'effect'
import 'server-only'

export type BookingCommitResult = { ok: true } | { ok: false; error: 'slot_taken' }

export type BookingCommitInput = {
  orgId: string
  appointment: Appointment
  actorUid: string
  via: string
  security?: WriteSecurity
}

const EXCLUSION_VIOLATION = '23P01'
const NO_DOUBLE_BOOK_CONSTRAINT = 'appointments_no_double_book'

function hasDoubleBookSignature(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  const constraint = (err as { constraint?: unknown }).constraint
  return code === EXCLUSION_VIOLATION || constraint === NO_DOUBLE_BOOK_CONSTRAINT
}

const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

function isSlotTakenDefect(defect: unknown): boolean {
  let current: unknown = defect
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    if (hasDoubleBookSignature(current)) return true
    const parked = (current as { [FIBER_FAILURE_CAUSE]?: unknown })[FIBER_FAILURE_CAUSE]
    if (Cause.isCause(parked)) {
      current = Cause.squash(parked)
      continue
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export async function commitAppointmentBooking({
  orgId,
  appointment,
  actorUid,
  via,
  security,
}: BookingCommitInput): Promise<BookingCommitResult> {
  const ref = aggregateRef(AppointmentConfig, orgId, appointment.id)
  const result = await Effect.runPromise(
    appendEvent(AppointmentConfig, ref, {
      _tag: 'appointment.created',
      actorId: actorUid,
      payload: { data: appointment },
    }).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchAllDefect((defect) => {
        if (isSlotTakenDefect(defect)) {
          return Effect.succeed({ ok: false as const, error: 'slot_taken' as const })
        }
        return Effect.die(defect)
      }),
      Effect.provide(Layer.merge(PostgresPersistenceLayer, securityLayer(security))),
    ),
  )

  if (!result.ok) {
    logger.warn('appointment.double_book_blocked', {
      orgId: appointment.orgId,
      actorUid,
      via,
      appointmentId: appointment.id,
      memberOperationId: appointment.memberOperationId,
      unitId: appointment.unitId,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
    })
  }
  return result
}
