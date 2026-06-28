import type { Appointment } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { logger } from '@/shared/lib'
import { Cause, Effect } from 'effect'
import 'server-only'

// Anti-double-book guard for appointment creation (#843), Postgres edition.
//
// The guarantee is now the database's: the `appointments_no_double_book` GiST
// EXCLUDE constraint (migration 0013) refuses any two `scheduled` appointments
// for the same org + memberOperation whose `[start_at, end_at)` intervals overlap.
// We emit the `appointment.created` event through the event store; the projector
// INSERTs the row in the SAME ACID transaction, so a conflicting slot makes the
// INSERT raise 23P01 (exclusion_violation) and the whole tx rolls back — no
// event, no projection. There is no read-then-write TOCTOU window: the
// constraint is checked atomically at commit, serializing concurrent staff +
// public writers at the database.
//
// The staff/public callers run a pre-flight `checkSlotConflicts` for a friendly
// early error; THIS commit is the authoritative guard under contention.

// `conflictAppointmentId` was never consumed by any caller — the simplified
// contract drops it (a 23P01 carries no second-row id without an extra SELECT).
export type BookingCommitResult = { ok: true } | { ok: false; error: 'slot_taken' }

export type BookingCommitInput = {
  // Org owning the appointment — scopes the event store's RLS transaction.
  orgId: string
  appointment: Appointment
  // Actor (staff uid, or `public:<customerId>` from the public landing).
  // Logged on the *blocked* attempt — the failed double-book.
  actorUid: string
  // Pipeline label ('internal_panel', 'public_landing', …). Logged on the
  // blocked attempt so we can split contention reports by entry point.
  via: string
}

// The Postgres exclusion-violation SQLSTATE — raised when the no-double-book
// constraint refuses an overlapping slot.
const EXCLUSION_VIOLATION = '23P01'
const NO_DOUBLE_BOOK_CONSTRAINT = 'appointments_no_double_book'

// A pg `DatabaseError` carries `code` (SQLSTATE) + `constraint`. Match either:
// the exclusion SQLSTATE or the named constraint identifies our double-book.
function hasDoubleBookSignature(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  const constraint = (err as { constraint?: unknown }).constraint
  return code === EXCLUSION_VIOLATION || constraint === NO_DOUBLE_BOOK_CONSTRAINT
}

// The pg error does NOT arrive bare. The layer's `runTransaction` runs the inner
// Effect via `Effect.runPromise`, which rejects with a `FiberFailure` — and the
// outer `Effect.promise` then dies with THAT, so the defect is a `FiberFailure`
// (sometimes nested twice). A `FiberFailure` does not expose the original error
// on `.cause`; it parks the Effect `Cause` under a private symbol. Pull the
// `Cause` out, `squash` it to the underlying defect value, and check that — then
// recurse, since a doubly-wrapped failure squashes to another `FiberFailure`.
// Falls back to a plain `.cause`/top-level check for any path where the pg error
// surfaces unwrapped.
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

function isSlotTakenDefect(defect: unknown): boolean {
  let current: unknown = defect
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    if (hasDoubleBookSignature(current)) return true
    // Read the parked `Cause` / `.cause` via the same narrow-cast idiom this file
    // uses for `code`/`constraint` (an optional named member — a structural
    // supertype, so no `any` and no unsafe assertion; an absent key → `undefined`).
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
}: BookingCommitInput): Promise<BookingCommitResult> {
  const ref = aggregateRef(AppointmentConfig, orgId, appointment.id)
  // Event-first: the appointment doc is the projection of `appointment.created`,
  // written in the same tx as the event append. The GiST exclusion constraint
  // fires on the projection INSERT when the slot overlaps a live booking.
  const result = await Effect.runPromise(
    appendEvent(AppointmentConfig, ref, {
      _tag: 'appointment.created',
      actorId: actorUid,
      payload: { data: appointment },
    }).pipe(
      Effect.map(() => ({ ok: true as const })),
      // The 23P01 from the exclusion constraint surfaces as a DEFECT (the pg
      // error is re-thrown by the layer's `Effect.promise`), not a typed
      // failure — mirror `catchSagaDefect` in the effect bridge and map the
      // double-book defect to the graceful `slot_taken` result. Any OTHER
      // defect is re-raised (a real 500 — not silently swallowed).
      Effect.catchAllDefect((defect) => {
        if (isSlotTakenDefect(defect)) {
          return Effect.succeed({ ok: false as const, error: 'slot_taken' as const })
        }
        return Effect.die(defect)
      }),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )

  if (!result.ok) {
    // Double-book blocked by the DB constraint. A health/contention signal
    // (infra), not domain state — nothing was written (the tx rolled back), so
    // there is no event. Goes to `logger`, not `audit_logs` (ES eradication,
    // #1029).
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
