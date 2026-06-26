import { describe, expect, it, vi } from 'vitest'
import { attachCanDelete } from './delete-guard'

// Pure unit of `attachCanDelete`: the batch helper that maps each row to a
// `canDelete` flag via an injected existence probe. The probe is stubbed (no
// I/O), so this exercises the generic mapping/parallelism without a database —
// the entity-specific probes are proven against real Postgres in the
// `*.events.pg.integration` suite.
describe('attachCanDelete', () => {
  it('flags a row deletable iff it has no active reference', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    // `b` is referenced (not deletable); `a` and `c` are free.
    const probe = vi.fn((id: string) => Promise.resolve(id === 'b'))

    const result = await attachCanDelete(rows, probe)

    expect(result).toEqual([
      { id: 'a', canDelete: true },
      { id: 'b', canDelete: false },
      { id: 'c', canDelete: true },
    ])
    // One probe per row.
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
