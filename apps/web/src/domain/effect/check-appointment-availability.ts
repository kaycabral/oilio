import { Effect, Schema } from 'effect'

import { AgendaBlock } from '../types/agenda-block'
import { getBlockSegmentsForDay } from '../utils/agenda-blocks'
import { findAppointmentConflicts, type AppointmentInterval } from '../utils/appointment-overlap'
import { AppointmentConflictError, EntityNotFoundError } from './errors'
import { FirestoreService } from './services'

// Overlap detection needs only these fields off each stored appointment; decode
// just this projection (excess ignored) so the read tolerates the full doc.
const AppointmentForOverlap = Schema.Struct({
  id: Schema.String,
  professionalId: Schema.String,
  startAt: Schema.String,
  endAt: Schema.String,
  status: Schema.String,
})

export function checkAppointmentAvailability(input: {
  readonly orgId: string
  readonly unitId: string
  readonly professionalId: string
  readonly proposed: AppointmentInterval
  readonly date: string
  readonly tz: string
  readonly excludeAppointmentId?: string | null
}) {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService

    const professionalDoc = yield* firestore.getDoc(
      `orgs/${input.orgId}/professionals/${input.professionalId}`,
    )
    if (!professionalDoc) {
      return yield* Effect.fail(
        new EntityNotFoundError({ entity: 'Professional', id: input.professionalId }),
      )
    }

    const appointmentDocs = yield* firestore.getDocs(`orgs/${input.orgId}/appointments`, [
      { kind: 'where', field: 'unitId', op: '==', value: input.unitId },
      { kind: 'where', field: 'professionalId', op: '==', value: input.professionalId },
    ])
    const existing = appointmentDocs.map((d) => Schema.decodeUnknownSync(AppointmentForOverlap)(d))

    const blockDocs = yield* firestore.getDocs(`orgs/${input.orgId}/agendaBlocks`)
    // Raw blocks (recurring/one-off) resolved to concrete day segments — the
    // shape `findAppointmentConflicts` expects (previously a raw-doc cast).
    const blocks = blockDocs.map((d) => Schema.decodeUnknownSync(AgendaBlock)(d))
    const blockSegments = getBlockSegmentsForDay(blocks, input.date, input.tz)

    const conflicts = findAppointmentConflicts({
      proposed: input.proposed,
      professionalId: input.professionalId,
      existing,
      blockSegments,
      date: input.date,
      tz: input.tz,
      excludeAppointmentId: input.excludeAppointmentId,
    })

    if (conflicts.length > 0) {
      return yield* Effect.fail(
        new AppointmentConflictError({
          professionalId: input.professionalId,
          proposedStart: input.proposed.startAt,
          proposedEnd: input.proposed.endAt,
          conflictingIds: conflicts.map((c) =>
            c.kind === 'appointment' ? c.appointmentId : c.blockId,
          ),
        }),
      )
    }

    return { available: true as const }
  })
}
