import { describe, expect, it } from 'vitest'
import { scopeByUnit } from './scope'

type Applied = { field: string; value: string }
function fakeQuery(applied: Applied[] = []) {
  const q = {
    applied,
    where(field: 'unitId', _op: '==', value: string) {
      return fakeQuery([...applied, { field, value }])
    },
  }
  return q
}

describe('scopeByUnit (brief 0043, AC-03)', () => {
  it('filters by unitId when a unit is active', () => {
    const scoped = scopeByUnit(fakeQuery(), 'unit-a')
    expect(scoped.applied).toEqual([{ field: 'unitId', value: 'unit-a' }])
  })

  it('leaves the query org-wide when no unit is active (null)', () => {
    const base = fakeQuery()
    const scoped = scopeByUnit(base, null)
    expect(scoped).toBe(base)
    expect(scoped.applied).toEqual([])
  })
})
