import { describe, expect, it } from 'vitest'

import { filterBySearch } from './filter-by-search'

type Row = { name: string; email: string | null }

const rows: Row[] = [
  { name: 'Ana Paula', email: 'ana@example.com' },
  { name: 'Bruno Lima', email: null },
  { name: 'Carla Souza', email: 'CARLA@EXAMPLE.COM' },
]

const fields = (r: Row): (string | null)[] => [r.name, r.email]

describe('filterBySearch', () => {
  it('returns a fresh copy of every item for an empty query', () => {
    const out = filterBySearch(rows, '', fields)
    expect(out).toEqual(rows)
    expect(out).not.toBe(rows)
  })

  it('treats a whitespace-only query as empty (whole set, unchanged)', () => {
    expect(filterBySearch(rows, '   ', fields)).toEqual(rows)
  })

  it('matches a case-insensitive substring across the provided fields', () => {
    expect(filterBySearch(rows, 'lima', fields)).toEqual([rows[1]])
    expect(filterBySearch(rows, 'ANA', fields)).toEqual([rows[0]])
  })

  it('matches against any field, not just the first', () => {
    // "carla@example.com" only matches via the email field (and case-folded).
    expect(filterBySearch(rows, 'carla@example', fields)).toEqual([rows[2]])
  })

  it('tolerates null/undefined field values without throwing', () => {
    // Bruno has a null email; the null field must be skipped, not crash.
    expect(filterBySearch(rows, 'bruno', fields)).toEqual([rows[1]])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterBySearch(rows, 'zzz', fields)).toEqual([])
  })
})
