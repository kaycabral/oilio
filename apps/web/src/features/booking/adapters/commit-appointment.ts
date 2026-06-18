import { Appointment, intervalsOverlap } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { buildInitialEvent } from '@/domain/effect'
import { fsConverter } from '@/shared/db/converter'
import { logger } from '@/shared/lib'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import 'server-only'

// Anti-double-book guard for appointment creation (#843).
//
// Why a transaction: both the staff agenda and the public landing can write
// appointments concurrently. Reading existing appointments outside a tx and
// writing afterwards leaves a TOCTOU window — two writers can each see "no
// conflict" and both succeed.
//
// We wrap the conflict probe + write in `runTransaction`. The firebase-admin
// SDK uses pessimistic concurrency control: reads inside the tx lock the
// queried index range, so a concurrent insert that would match the query is
// serialized — the second writer sees the first's commit on retry and aborts
// with `slot_taken`. The SDK auto-retries on contention (default 5 attempts).
//
// We do NOT validate agenda blocks here — blocks are static (owner-edited),
// not racy; staff callers check them in a pre-flight outside this helper.

export type BookingCommitResult =
  | { ok: true }
  | { ok: false; error: 'slot_taken'; conflictAppointmentId: string }

export type BookingCommitInput = {
  db: Firestore
  orgRef: DocumentReference
  appointment: Appointment
  // Actor (staff uid, or `public:<customerId>` from the public landing).
  // Logged on the *blocked* attempt — the failed double-book.
  actorUid: string
  // Pipeline label ('agenda', 'public_landing', …). Logged on the blocked
  // attempt so we can split contention reports by entry point.
  via: string
}

// How far to widen the lower bound below `appointment.startAt` when probing
// for conflicts. An overlap can only exist when another appointment started
// at most `(its duration)` ago — 24h is generous and far exceeds any single
// service duration we ship.
const CONFLICT_LOOKBACK_MS = 24 * 60 * 60_000

export async function commitAppointmentBooking({
  db,
  orgRef,
  appointment,
  actorUid,
  via,
}: BookingCommitInput): Promise<BookingCommitResult> {
  const apptRef = orgRef.collection('appointments').doc(appointment.id)
  // Event-first: o doc do appointment é projeção do `appointment.created`, não um
  // write direto. Montamos o evento (version 1 — aggregate novo) FORA da tx pra
  // falhar cedo em validação; dentro da tx gravamos o envelope + a projeção
  // atomicamente com o guard anti-double-book (que precisa de range-query, fora
  // do alcance do `TransactionContext` do effect-layer). Sem dual-write.
  const created = buildInitialEvent(AppointmentConfig, {
    _tag: 'appointment.created',
    actorId: actorUid,
    payload: { data: appointment },
  })
  const start = new Date(appointment.startAt).getTime()
  const end = new Date(appointment.endAt).getTime()
  const lowerBound = new Date(start - CONFLICT_LOOKBACK_MS).toISOString()
  const upperBound = new Date(end + CONFLICT_LOOKBACK_MS).toISOString()
  const conflictQuery = orgRef
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .where('professionalId', '==', appointment.professionalId)
    .where('startAt', '>=', lowerBound)
    .where('startAt', '<=', upperBound)

  const result = await db.runTransaction(async (tx) => {
    const conflictSnap = await tx.get(conflictQuery)
    const conflict = conflictSnap.docs
      .map((d) => d.data())
      .find(
        (a) =>
          a.id !== appointment.id &&
          a.status !== 'cancelled' &&
          intervalsOverlap({ startAt: appointment.startAt, endAt: appointment.endAt }, a),
      )
    if (conflict) {
      return {
        ok: false as const,
        error: 'slot_taken' as const,
        conflictAppointmentId: conflict.id,
      }
    }
    // Event-first: append do `appointment.created` + projeção, atômico com o probe.
    tx.set(apptRef.collection('events').doc(created.eventId), created.envelope)
    tx.set(apptRef, created.projection)
    return { ok: true as const }
  })

  if (!result.ok) {
    // Tentativa de double-book bloqueada pelo guard de concorrência. Sinal de
    // saúde/contention (infra), não estado de domínio — nada foi escrito, logo
    // não há evento. Vai pro `logger`, não pra `audit_logs` (erradicação ES,
    // #1029). Fora da tx: o log não precisa ser atômico e a tx não re-tenta no
    // ramo de conflito (retorna em vez de throw).
    logger.warn('appointment.double_book_blocked', {
      orgId: appointment.orgId,
      actorUid,
      via,
      appointmentId: appointment.id,
      conflictAppointmentId: result.conflictAppointmentId,
      professionalId: appointment.professionalId,
      unitId: appointment.unitId,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
    })
  }
  return result
}
