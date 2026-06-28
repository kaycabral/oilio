import { Effect, Schema } from 'effect'

import { AgendaBlockConfig } from '@/domain/aggregates/agenda-block/config'
import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { MemberOperationConfig } from '@/domain/aggregates/member-operation/config'
import { aggregateRef, collectionRef } from '@/domain/effect/aggregate-ref'
import { AgendaBlock } from '../types/agenda-block'
import { getBlockSegmentsForDay } from '../utils/agenda-blocks'
import { findAppointmentConflicts, type AppointmentInterval } from '../utils/appointment-overlap'
import { AppointmentConflictError, EntityNotFoundError } from './errors'
import { PersistencePort } from './services'

// Overlap detection needs only these fields off each stored appointment; decode
// just this projection (excess ignored) so the read tolerates the full doc.
const AppointmentForOverlap = Schema.Struct({
  id: Schema.String,
  memberOperationId: Schema.String,
  startAt: Schema.String,
  endAt: Schema.String,
  status: Schema.String,
})

export function checkAppointmentAvailability(input: {
  readonly orgId: string
  readonly unitId: string
  readonly memberOperationId: string
  readonly proposed: AppointmentInterval
  readonly date: string
  readonly tz: string
  readonly excludeAppointmentId?: string | null
}) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort

    const memberOperationDoc = yield* persistence.getDoc(
      aggregateRef(MemberOperationConfig, input.orgId, input.memberOperationId),
    )
    if (!memberOperationDoc) {
      return yield* Effect.fail(
        new EntityNotFoundError({ entity: 'MemberOperation', id: input.memberOperationId }),
      )
    }

    const appointmentDocs = yield* persistence.getDocs(
      collectionRef(AppointmentConfig, input.orgId),
      [
        { kind: 'where', field: 'unitId', op: '==', value: input.unitId },
        { kind: 'where', field: 'memberOperationId', op: '==', value: input.memberOperationId },
      ],
    )
    const existing = appointmentDocs.map((d) => Schema.decodeUnknownSync(AppointmentForOverlap)(d))

    const blockDocs = yield* persistence.getDocs(collectionRef(AgendaBlockConfig, input.orgId))
    // Raw blocks (recurring/one-off) resolved to concrete day segments — the
    // shape `findAppointmentConflicts` expects (previously a raw-doc cast).
    const blocks = blockDocs.map((d) => Schema.decodeUnknownSync(AgendaBlock)(d))
    const blockSegments = getBlockSegmentsForDay(blocks, input.date, input.tz)

    const conflicts = findAppointmentConflicts({
      proposed: input.proposed,
      memberOperationId: input.memberOperationId,
      existing,
      blockSegments,
      date: input.date,
      tz: input.tz,
      excludeAppointmentId: input.excludeAppointmentId,
    })

    if (conflicts.length > 0) {
      return yield* Effect.fail(
        new AppointmentConflictError({
          memberOperationId: input.memberOperationId,
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
