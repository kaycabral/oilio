import { describe, expect, it } from 'vitest'
import type { AgendaBlock, RecurringAgendaBlock } from '../types/agenda-block'
import { getBlockSegmentsForDay } from './agenda-blocks'

const BR = 'America/Sao_Paulo'

const lunch = (id: string): RecurringAgendaBlock => ({
  id,
  tenantId: 't1',
  unitId: 'u1',
  professionalId: 'p1',
  reason: 'Almoço',
  kind: 'recurring',
  weekday: 'thursday',
  open: '12:00',
  close: '13:00',
  startAt: null,
  endAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
})

const oneOff = (id: string, startUtc: string, endUtc: string): AgendaBlock => ({
  id,
  tenantId: 't1',
  unitId: 'u1',
  professionalId: null,
  reason: 'Feriado',
  kind: 'one_off',
  weekday: null,
  open: null,
  close: null,
  startAt: startUtc,
  endAt: endUtc,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
})

describe('getBlockSegmentsForDay', () => {
  it('returns the recurring block when weekday matches', () => {
    const segs = getBlockSegmentsForDay([lunch('b1')], '2026-05-14', BR)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({
      blockId: 'b1',
      professionalId: 'p1',
      reason: 'Almoço',
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
  })

  it('skips recurring block on a different weekday', () => {
    // 2026-05-15 is Friday
    expect(getBlockSegmentsForDay([lunch('b1')], '2026-05-15', BR)).toHaveLength(0)
  })

  it('intersects one-off interval that lies on the day', () => {
    // 14:00–16:00 BR on 2026-05-20 = 17:00–19:00 UTC
    const b = oneOff('b2', '2026-05-20T17:00:00.000Z', '2026-05-20T19:00:00.000Z')
    const segs = getBlockSegmentsForDay([b], '2026-05-20', BR)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({
      blockId: 'b2',
      professionalId: null,
      startMin: 14 * 60,
      endMin: 16 * 60,
    })
  })

  it('clips one-off that starts the day before in BR', () => {
    // 23:00 BR (=02:00 UTC next day) on 2026-05-19 to 02:00 BR on 2026-05-20.
    // For 2026-05-20: starts before the day, ends at 02:00 → segment [0, 120]
    const b = oneOff('b3', '2026-05-20T02:00:00.000Z', '2026-05-20T05:00:00.000Z')
    const segs = getBlockSegmentsForDay([b], '2026-05-20', BR)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ startMin: 0, endMin: 2 * 60 })
  })

  it('covers full day when one-off spans across multiple days', () => {
    // Whole-week vacation: 2026-05-18 00:00 BR to 2026-05-25 00:00 BR
    const b = oneOff('b4', '2026-05-18T03:00:00.000Z', '2026-05-25T03:00:00.000Z')
    const segs = getBlockSegmentsForDay([b], '2026-05-20', BR)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ startMin: 0, endMin: 24 * 60 })
  })

  it('skips one-off that does not intersect the day', () => {
    const b = oneOff('b5', '2026-05-01T12:00:00.000Z', '2026-05-01T14:00:00.000Z')
    expect(getBlockSegmentsForDay([b], '2026-05-20', BR)).toHaveLength(0)
  })

  it('drops a degenerate recurring block whose close is not after open', () => {
    const bad: AgendaBlock = { ...lunch('b6'), open: '13:00', close: '13:00' }
    expect(getBlockSegmentsForDay([bad], '2026-05-14', BR)).toHaveLength(0)
  })

  it('drops a zero-length one-off block', () => {
    const b = oneOff('b7', '2026-05-20T17:00:00.000Z', '2026-05-20T17:00:00.000Z')
    expect(getBlockSegmentsForDay([b], '2026-05-20', BR)).toHaveLength(0)
  })

  it('returns multiple segments when several blocks intersect', () => {
    const segs = getBlockSegmentsForDay(
      [lunch('b1'), oneOff('b2', '2026-05-14T17:00:00.000Z', '2026-05-14T19:00:00.000Z')],
      '2026-05-14',
      BR,
    )
    expect(segs).toHaveLength(2)
  })
})
