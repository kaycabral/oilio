import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Regression guard for the prod "Session created failed 500" incident.
//
// Root cause: `instrumentation.ts` sat at the app root (apps/oilio/web/) while
// the app uses a `src/` folder. Per the Next.js file convention, with a `src/`
// folder the instrumentation file MUST live inside `src/`, or `register()` is
// never invoked at boot. Silently mis-placed, the eager `initEventStore()`
// never ran, so the first Postgres write (the session upsert on signup) fell
// through to `createManagedPoolSync()` — which THROWS under IAM auth
// (`OILIO_USE_IAM_AUTH=true requires async init`), surfacing as a 500.
//
// Two invariants locked here: the file's LOCATION (so it can't drift back to
// the root and go quiet again) and its BEHAVIOR (register wires the boot inits
// on Node, and no-ops off the Node runtime).

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
    // vitest cwd is the web package root (apps/oilio/web).
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
