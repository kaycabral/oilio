import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const initEventStore = vi.fn(() => Promise.resolve())
const initProductDb = vi.fn(() => Promise.resolve())

vi.mock('@/shared/db/pg', () => ({ initEventStore }))
vi.mock('@cbrl/product', () => ({ initProductDb }))

describe('instrumentation (boot eager-init) — session-500 regression guard', () => {
  const runtime = process.env.NEXT_RUNTIME

  afterEach(() => {
    vi.clearAllMocks()
    if (runtime === undefined) delete process.env.NEXT_RUNTIME
    else process.env.NEXT_RUNTIME = runtime
  })

  it('lives inside src/, not the app root (the misplacement that caused the 500)', () => {
    expect(
      existsSync(resolve(process.cwd(), 'src/instrumentation.ts')),
      'instrumentation.ts must be in src/ — with a src/ folder Next only runs register() from there',
    ).toBe(true)
    expect(
      existsSync(resolve(process.cwd(), 'instrumentation.ts')),
      'a root-level instrumentation.ts is dead: Next ignores it when a src/ folder exists',
    ).toBe(false)
  })

  it('opens both logical Postgres pools at boot on the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const { register } = await import('./instrumentation')
    await register()
    expect(initEventStore).toHaveBeenCalledOnce()
    expect(initProductDb).toHaveBeenCalledOnce()
  })

  it('is a no-op off the Node runtime (pg cannot run on Edge)', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    const { register } = await import('./instrumentation')
    await register()
    expect(initEventStore).not.toHaveBeenCalled()
    expect(initProductDb).not.toHaveBeenCalled()
  })
})
