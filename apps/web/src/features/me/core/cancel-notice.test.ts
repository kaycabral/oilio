import type { CancellationPolicy } from '@/domain'
import { describe, expect, it } from 'vitest'
import { describeCancelReason, formatNoticeWindow } from './cancel-notice'

const policy: CancellationPolicy = { enabled: true, minNoticeMinutes: 120 }

describe('formatNoticeWindow', () => {
  it('renders zero and sub-minute as minutos', () => {
    expect(formatNoticeWindow(0)).toBe('0 minutos')
    expect(formatNoticeWindow(-5)).toBe('0 minutos')
  })

  it('renders non-hour multiples as minutos', () => {
    expect(formatNoticeWindow(45)).toBe('45 minutos')
    expect(formatNoticeWindow(90)).toBe('90 minutos')
  })

  it('renders singular and plural hours', () => {
    expect(formatNoticeWindow(60)).toBe('1 hora')
    expect(formatNoticeWindow(120)).toBe('2 horas')
    expect(formatNoticeWindow(23 * 60)).toBe('23 horas')
  })

  it('renders whole days', () => {
    expect(formatNoticeWindow(24 * 60)).toBe('1 dia')
    expect(formatNoticeWindow(48 * 60)).toBe('2 dias')
  })

  it('falls back to horas for non-integer days', () => {
    expect(formatNoticeWindow(36 * 60)).toBe('36 horas')
  })
})

describe('describeCancelReason', () => {
  it('maps terminal statuses', () => {
    expect(
      describeCancelReason({ ok: false, reason: 'already_cancelled', minutesToStart: 0 }, policy),
    ).toBe('Já cancelado.')
    expect(
      describeCancelReason({ ok: false, reason: 'already_completed', minutesToStart: 0 }, policy),
    ).toBe('Já concluído.')
    expect(
      describeCancelReason({ ok: false, reason: 'already_no_show', minutesToStart: 0 }, policy),
    ).toBe('Marcado como falta.')
    expect(describeCancelReason({ ok: false, reason: 'past', minutesToStart: -10 }, policy)).toBe(
      'Horário já passou.',
    )
  })

  it('renders the required notice window for outside_window', () => {
    expect(
      describeCancelReason(
        { ok: false, reason: 'outside_window', minutesToStart: 30, requiredMinutes: 120 },
        policy,
      ),
    ).toBe('Cancele com pelo menos 2 horas de antecedência.')
  })
})
