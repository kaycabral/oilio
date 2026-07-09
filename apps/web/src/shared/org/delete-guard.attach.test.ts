import { describe, expect, it, vi } from 'vitest'
import { attachCanDelete } from './delete-guard'

describe('attachCanDelete', () => {
  it('flags a row deletable iff it has no active reference', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const probe = vi.fn((id: string) => Promise.resolve(id === 'b'))

    const result = await attachCanDelete(rows, probe)

    expect(result).toEqual([
      { id: 'a', canDelete: true },
      { id: 'b', canDelete: false },
      { id: 'c', canDelete: true },
    ])
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('preserves the other fields on each row', async () => {
    const result = await attachCanDelete([{ id: 'x', name: 'Foo' }], () => Promise.resolve(false))
    expect(result[0]).toEqual({ id: 'x', name: 'Foo', canDelete: true })
  })

  it('returns an empty list unchanged (no probe calls)', async () => {
    const probe = vi.fn(() => Promise.resolve(false))
    expect(await attachCanDelete([], probe)).toEqual([])
    expect(probe).not.toHaveBeenCalled()
  })
})
