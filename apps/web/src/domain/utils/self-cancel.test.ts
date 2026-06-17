import { describe, expect, it } from 'vitest'
import type { CancellationPolicy } from '../types/tenant'
import { canCustomerCancelAppointment } from './self-cancel'

const policyOff: CancellationPolicy = { enabled: false, minNoticeMinutes: 120 }
const policy2h: CancellationPolicy = { enabled: true, minNoticeMinutes: 120 }

function apptAt(
  startAt: string,
  status: 'scheduled' | 'cancelled' | 'completed' | 'no_show' = 'scheduled',
) {
  return { startAt, status } as const
}

const NOW = new Date('2026-06-01T12:00:00.000Z')

describe('canCustomerCancelAppointment', () => {
  it('allows cancel when policy is off and the appointment is still in the future', () => {
    const r = canCustomerCancelAppointment(apptAt('2026-06-01T12:30:00.000Z'), policyOff, NOW)
    expect(r).toEqual({ ok: true })
  })

  it('blocks past appointments even when policy is off', () => {
    const r = canCustomerCancelAppointment(apptAt('2026-06-01T11:30:00.000Z'), policyOff, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('past')
  })

  it('blocks inside the policy window', () => {
    // Appointment in 1h, policy requires 2h → blocked.
    const r = canCustomerCancelAppointment(apptAt('2026-06-01T13:00:00.000Z'), policy2h, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('outside_window')
    expect(r.minutesToStart).toBe(60)
    expect(r.requiredMinutes).toBe(120)
  })

  it('allows cancel exactly at the policy threshold', () => {
    // Appointment in 120 min, policy requires 120 → ok (>= boundary).
    const r = canCustomerCancelAppointment(apptAt('2026-06-01T14:00:00.000Z'), policy2h, NOW)
    expect(r).toEqual({ ok: true })
  })

  it('rejects already-cancelled', () => {
    const r = canCustomerCancelAppointment(
      apptAt('2026-06-02T12:00:00.000Z', 'cancelled'),
      policyOff,
      NOW,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('already_cancelled')
  })

  it('rejects already-completed', () => {
    const r = canCustomerCancelAppointment(
      apptAt('2026-06-02T12:00:00.000Z', 'completed'),
      policyOff,
      NOW,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('already_completed')
  })

  it('rejects already-no-show', () => {
    const r = canCustomerCancelAppointment(
      apptAt('2026-06-02T12:00:00.000Z', 'no_show'),
      policyOff,
      NOW,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('already_no_show')
  })

  // #1038 — snapshot-on-use. The helper decides purely from the policy it's
  // handed; the read-sites feed it `appointment.cancellationPolicySnapshot`.
  // This proves the booking-time policy (snapshot) drives the decision even
  // when the tenant's LIVE policy later diverges.
  describe('snapshot governs eligibility, not the live tenant policy (#1038)', () => {
    it('booked under strict policy → still blocked even if live policy is now off', () => {
      // Appointment 1h ahead. Snapshot froze a 2h window → inside it → blocked,
      // regardless of the tenant having since disabled cancellation.
      const snapshotAtCommit: CancellationPolicy = { enabled: true, minNoticeMinutes: 120 }
      const r = canCustomerCancelAppointment(
        apptAt('2026-06-01T13:00:00.000Z'),
        snapshotAtCommit,
        NOW,
      )
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('outside_window')
      expect(r.requiredMinutes).toBe(120)
    })

    it('booked under disabled policy → still allowed even if live policy is now strict', () => {
      // Appointment 1h ahead. Snapshot froze a disabled policy → allowed, even
      // though the tenant has since enabled a 2h window.
      const snapshotAtCommit: CancellationPolicy = { enabled: false, minNoticeMinutes: 120 }
      const r = canCustomerCancelAppointment(
        apptAt('2026-06-01T13:00:00.000Z'),
        snapshotAtCommit,
        NOW,
      )
      expect(r).toEqual({ ok: true })
    })
  })
})
