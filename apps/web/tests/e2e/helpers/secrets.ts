// Single source for E2E test secrets. These are test fixtures, not real env:
// the suite owns them, so they're plain constants — not read from process.env
// with a `??`/`if (!env)` fallback (the anti-pattern this harness eliminates).
//
// They cross into the Next server (which reads `process.env.CRON_SECRET` etc. as
// production code) via `webServer.env` in playwright.config.ts, sourced from
// these same constants — so the value the spec sends and the value the server
// validates can't drift. Specs import the constant directly; they never read
// the env. Mirrors tests/e2e/helpers/emulator.ts (the emulator-coord source).

export const CRON_SECRET = 'e2e-cron-secret'
