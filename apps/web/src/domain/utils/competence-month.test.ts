import { describe, expect, it } from 'vitest'

import {
  enumerateCompetenceMonths,
  firstInstantOfMonthUtc,
  overlapsWindow,
  toOrgMonth,
} from './competence-month'

const SP = 'America/Sao_Paulo'
const UTC = 'UTC'

describe('toOrgMonth', () => {
  it('derives the competence month in the org timezone', () => {
    expect(toOrgMonth('2026-07-15T12:00:00.000Z', UTC)).toBe('2026-07')
  })

  it('rolls to the previous month when the org tz shifts the instant back', () => {
    expect(toOrgMonth('2026-08-01T02:00:00.000Z', SP)).toBe('2026-07')
  })
})

describe('firstInstantOfMonthUtc', () => {
  it('is midnight UTC for a UTC org', () => {
    expect(firstInstantOfMonthUtc('2026-07', UTC)).toBe('2026-07-01T00:00:00.000Z')
  })

  it('is 03:00 UTC for a -03:00 org (São Paulo)', () => {
    expect(firstInstantOfMonthUtc('2026-07', SP)).toBe('2026-07-01T03:00:00.000Z')
  })
})

describe('enumerateCompetenceMonths', () => {
  it('lists each month of a half-open window [from, to)', () => {
    const months = enumerateCompetenceMonths(
      '2026-01-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      UTC,
    )
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('excludes the end month when the window ends exactly at its start (half-open)', () => {
    const months = enumerateCompetenceMonths(
      '2026-01-10T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      UTC,
    )
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02'])
  })

  it('returns a single month for a within-month window', () => {
    const months = enumerateCompetenceMonths(
      '2026-06-05T00:00:00.000Z',
      '2026-06-20T00:00:00.000Z',
      UTC,
    )
    expect(months.map((m) => m.month)).toEqual(['2026-06'])
  })

  it('is empty for an inverted window', () => {
    expect(
      enumerateCompetenceMonths('2026-06-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', UTC),
    ).toEqual([])
  })
})

describe('overlapsWindow', () => {
  it('an open vigência covers every month from effectiveFrom on', () => {
    expect(overlapsWindow('2026-01-01T00:00:00.000Z', null, '2026-06', UTC)).toBe(true)
    expect(overlapsWindow('2026-07-01T00:00:00.000Z', null, '2026-06', UTC)).toBe(false)
  })

  it('a closed vigência excludes the month it ends on (half-open)', () => {
    expect(
      overlapsWindow('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06', UTC),
    ).toBe(false)
    expect(
      overlapsWindow('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-05', UTC),
    ).toBe(true)
  })
})
