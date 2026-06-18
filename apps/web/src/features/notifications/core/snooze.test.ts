import { describe, expect, it } from 'vitest'
import { computeSnoozeUntil, isSnoozeOption, isSnoozedAt } from './snooze'

const TZ = 'America/Sao_Paulo'

describe('computeSnoozeUntil', () => {
  it('4h → agora + 4 horas', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    expect(computeSnoozeUntil('4h', now, TZ)).toBe('2026-06-01T16:00:00.000Z')
  })

  it('tomorrow → amanhã 09:00 no fuso do org (12:00 UTC)', () => {
    // 2026-06-01 14:00 UTC = 11:00 em SP → amanhã 09:00 SP = 12:00 UTC dia 02
    const now = new Date('2026-06-01T14:00:00.000Z')
    expect(computeSnoozeUntil('tomorrow', now, TZ)).toBe('2026-06-02T12:00:00.000Z')
  })

  it('tomorrow perto da meia-noite org → ainda usa o dia seguinte local', () => {
    // 2026-06-02 02:00 UTC = 2026-06-01 23:00 em SP → amanhã = 06-02 09:00 SP = 06-02 12:00 UTC
    const now = new Date('2026-06-02T02:00:00.000Z')
    expect(computeSnoozeUntil('tomorrow', now, TZ)).toBe('2026-06-02T12:00:00.000Z')
  })
})

describe('isSnoozeOption', () => {
  it('aceita 4h e tomorrow', () => {
    expect(isSnoozeOption('4h')).toBe(true)
    expect(isSnoozeOption('tomorrow')).toBe(true)
  })
  it('rejeita o resto', () => {
    expect(isSnoozeOption('1h')).toBe(false)
    expect(isSnoozeOption('')).toBe(false)
  })
})

describe('isSnoozedAt', () => {
  const now = new Date('2026-06-01T12:00:00.000Z')
  it('null → não snoozed', () => {
    expect(isSnoozedAt(null, now)).toBe(false)
  })
  it('futuro → snoozed (oculto)', () => {
    expect(isSnoozedAt('2026-06-01T16:00:00.000Z', now)).toBe(true)
  })
  it('passado → não snoozed (volta a aparecer)', () => {
    expect(isSnoozedAt('2026-06-01T08:00:00.000Z', now)).toBe(false)
  })
})
