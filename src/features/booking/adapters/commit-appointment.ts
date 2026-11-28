import type { Appointment } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { pgErrorOf } from '@/shared/db/pg/pg-error'
import { securityLayer, type WriteSecurity } from '@/shared/effect-bridge'
import { logger } from '@cbrl/log'
import { PG_ERROR } from '@cbrl/pg'
import { Effect, Layer } from 'effect'
import 'server-only'

export type BookingCommitResult = { ok: true } | { ok: false; error: 'slot_taken' }

export type BookingCommitInput = {
  orgId: string
  appointment: Appointment
  actorUid: string
  via: string
  security?: WriteSecurity
}

const NO_DOUBLE_BOOK_CONSTRAINT = 'appointments_no_double_book'

function isSlotTakenDefect(defect: unknown): boolean {
  const { code, constraint } = pgErrorOf(defect)
  return code === PG_ERROR.EXCLUSION_VIOLATION || constraint === NO_DOUBLE_BOOK_CONSTRAINT
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
      Effect.catchDefect((defect) => {
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
