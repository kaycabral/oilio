// Integration test for the anti-double-book transaction (#843).
//
// Runs against the Firebase emulator (firestore on 127.0.0.1:8080). Start
// emulators in another terminal:
//
//   pnpm --filter @oilio/web db:start
//   pnpm --filter @oilio/web test:integration
//
// The test boots the admin SDK pointed at the emulator and runs N parallel
// `commitAppointmentBooking` calls targeting the same slot. The contract
// is: exactly 1 wins, N-1 fail with `slot_taken`, and the guard emits N-1
// `logger.warn('appointment.double_book_blocked')` calls (infra/contention
// signal — não `audit_logs`, erradicação ES #1029).

import type { Appointment } from '@/domain'
import { logger } from '@/shared/lib'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitAppointmentBooking } from './commit-appointment'

// Spy no logger (infra signal do double-book) — mock só do logger é permitido
// (a regra proíbe mock de Firestore; este teste segue hitando o emulator).
const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

const PROJECT_ID = `commit-appt-${Date.now()}`

let app: App
let db: Firestore

beforeAll(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(app)
})

function uniqueOrgId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

function buildAppointment(
  orgId: string,
  id: string,
  startAtIso: string,
  durationMinutes = 30,
): Appointment {
  const startMs = new Date(startAtIso).getTime()
  return {
    id,
    orgId,
    unitId: 'u1',
    professionalId: 'p1',
    customerId: `c-${id}`,
    serviceId: 's1',
    startAt: startAtIso,
    endAt: new Date(startMs + durationMinutes * 60_000).toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: durationMinutes,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: `u-${id}`,
    professionalUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('commitAppointmentBooking', () => {
  let orgId: string

  beforeEach(() => {
    orgId = uniqueOrgId('basic')
    warnSpy.mockClear()
  })

  it('writes a single appointment when there is no contention', async () => {
    const orgRef = db.collection('orgs').doc(orgId)
    const appt = buildAppointment(orgId, 'a1', '2026-08-15T13:00:00.000Z')
    const res = await commitAppointmentBooking({
      db,
      orgRef,
      appointment: appt,
      actorUid: 'staff',
      via: 'internal_panel',
    })
    expect(res).toEqual({ ok: true })
    const written = await orgRef.collection('appointments').doc('a1').get()
    expect(written.exists).toBe(true)
  })

  it('rejects an overlapping appointment for the same professional', async () => {
    const orgRef = db.collection('orgs').doc(orgId)
    await commitAppointmentBooking({
      db,
      orgRef,
      appointment: buildAppointment(orgId, 'first', '2026-08-15T13:00:00.000Z'),
      actorUid: 'staff',
      via: 'internal_panel',
    })

    const overlap = buildAppointment(orgId, 'second', '2026-08-15T13:15:00.000Z')
    const res = await commitAppointmentBooking({
      db,
      orgRef,
      appointment: overlap,
      actorUid: 'public:c-second',
      via: 'public_landing',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('slot_taken')
    expect(res.conflictAppointmentId).toBe('first')

    // O perdedor emite o sinal de contention via logger (não audit_logs).
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'appointment.double_book_blocked',
      expect.objectContaining({ conflictAppointmentId: 'first' }),
    )
  })

  it('allows back-to-back appointments (half-open intervals)', async () => {
    const orgRef = db.collection('orgs').doc(orgId)
    const first = buildAppointment(orgId, 'a', '2026-08-15T13:00:00.000Z', 30)
    await commitAppointmentBooking({
      db,
      orgRef,
      appointment: first,
      actorUid: 'staff',
      via: 'internal_panel',
    })
    // Starts exactly when the previous one ends — should pass.
    const adjacent = buildAppointment(orgId, 'b', '2026-08-15T13:30:00.000Z', 30)
    const res = await commitAppointmentBooking({
      db,
      orgRef,
      appointment: adjacent,
      actorUid: 'staff',
      via: 'internal_panel',
    })
    expect(res).toEqual({ ok: true })
  })

  it('ignores cancelled appointments when probing conflicts', async () => {
    const orgRef = db.collection('orgs').doc(orgId)
    const cancelled = buildAppointment(orgId, 'cancelled', '2026-08-15T13:00:00.000Z')
    cancelled.status = 'cancelled'
    await orgRef.collection('appointments').doc('cancelled').set(cancelled)

    const fresh = buildAppointment(orgId, 'fresh', '2026-08-15T13:00:00.000Z')
    const res = await commitAppointmentBooking({
      db,
      orgRef,
      appointment: fresh,
      actorUid: 'staff',
      via: 'internal_panel',
    })
    expect(res).toEqual({ ok: true })
  })

  it('serializes 10 concurrent writers — exactly one wins, audit logs the rest', async () => {
    const orgRef = db.collection('orgs').doc(uniqueOrgId('race'))
    const startAt = '2026-08-15T14:00:00.000Z'
    const writers = Array.from({ length: 10 }, (_, i) =>
      commitAppointmentBooking({
        db,
        orgRef,
        appointment: buildAppointment(orgRef.id, `race-${i}`, startAt),
        actorUid: `public:race-${i}`,
        via: 'public_landing',
      }),
    )
    const results = await Promise.all(writers)
    const successes = results.filter((r) => r.ok)
    const failures = results.filter((r) => !r.ok)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(9)
    for (const f of failures) {
      if (f.ok) continue
      expect(f.error).toBe('slot_taken')
    }

    // Os 9 perdedores emitem o sinal de contention via logger (não audit_logs).
    const blocked = warnSpy.mock.calls.filter((c) => c[0] === 'appointment.double_book_blocked')
    expect(blocked).toHaveLength(9)
  }, 30_000)

  it('lets two different professionals book the same slot', async () => {
    const orgRef = db.collection('orgs').doc(uniqueOrgId('two-pros'))
    const startAt = '2026-08-15T15:00:00.000Z'
    const apptA = buildAppointment(orgRef.id, 'a', startAt)
    const apptB = buildAppointment(orgRef.id, 'b', startAt)
    apptB.professionalId = 'p2'
    const [resA, resB] = await Promise.all([
      commitAppointmentBooking({
        db,
        orgRef,
        appointment: apptA,
        actorUid: 'staff',
        via: 'internal_panel',
      }),
      commitAppointmentBooking({
        db,
        orgRef,
        appointment: apptB,
        actorUid: 'staff',
        via: 'internal_panel',
      }),
    ])
    expect(resA).toEqual({ ok: true })
    expect(resB).toEqual({ ok: true })
  })
})
