import type { Appointment } from '@/domain'
import { describe, expect, it } from 'vitest'
import { decideCancel, decideNoShow, decideUnmarkNoShow } from './appointment-transitions'

const START = '2026-06-10T14:00:00.000Z'
const base = (status: Appointment['status']): Pick<Appointment, 'status' | 'startAt'> => ({
  status,
  startAt: START,
})

describe('decideCancel', () => {
  it('allows cancel from a live booking and returns the event facts', () => {
    const now = '2026-06-10T13:30:00.000Z'
    const d = decideCancel(base('scheduled'), 'staff', now)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.value.cancelledBy).toBe('staff')
    expect(d.value.cancelledAt).toBe(now)
    expect(d.value.noticeMinutes).toBe(30)
  })

  it('forwards the actor (customer self-cancel reuses the same core)', () => {
    const d = decideCancel(base('scheduled'), 'customer', START)
    expect(d.ok && d.value.cancelledBy).toBe('customer')
  })

  it('refuses an already-cancelled booking', () => {
    const d = decideCancel(base('cancelled'), 'staff', START)
    expect(d).toEqual({ ok: false, error: 'Agendamento já está cancelado' })
  })
})

describe('decideNoShow', () => {
  it('refuses before the slot started', () => {
    const now = new Date('2026-06-10T13:59:00.000Z')
    const d = decideNoShow(base('scheduled'), now)
    expect(d).toEqual({
      ok: false,
      error: 'Só é possível marcar não compareceu após o horário marcado',
    })
  })

  it('allows once the slot has started', () => {
    const now = new Date('2026-06-10T14:01:00.000Z')
    expect(decideNoShow(base('scheduled'), now).ok).toBe(true)
  })

  it('refuses an already no-show booking', () => {
    const now = new Date('2026-06-10T15:00:00.000Z')
    expect(decideNoShow(base('no_show'), now)).toEqual({
      ok: false,
      error: 'Agendamento já está marcado como não compareceu',
    })
  })

  it('refuses a cancelled booking', () => {
    const now = new Date('2026-06-10T15:00:00.000Z')
    expect(decideNoShow(base('cancelled'), now)).toEqual({
      ok: false,
      error: 'Agendamento cancelado não pode virar não compareceu',
    })
  })
})

describe('decideUnmarkNoShow', () => {
  it('allows reverting a no-show', () => {
    expect(decideUnmarkNoShow({ status: 'no_show' }).ok).toBe(true)
  })

  it('refuses reverting anything that is not a no-show', () => {
    expect(decideUnmarkNoShow({ status: 'scheduled' })).toEqual({
      ok: false,
      error: 'Agendamento não está marcado como não compareceu',
    })
  })
})
