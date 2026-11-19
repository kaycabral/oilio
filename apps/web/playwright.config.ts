import { defineConfig, devices } from '@playwright/test'

import { CRON_SECRET } from './tests/e2e/helpers/secrets'

// oilio/web runs on port 3005 (see CLAUDE.md "MCPs e portas dev" mapa).
// `webServer` starts the Next server only — the local Supabase stack is owned
// by `pnpm db:start`, and `scripts/e2e.ts` (the `test:e2e` script) resolves it.
// With `reuseExistingServer: true` locally, Playwright reuses the Next process
// if it's already up.
//
// **Default: production build (`pnpm build && pnpm start`).** This matches
// Playwright + Next.js guidance — testing against `next dev` exposes specs
// to dev-only races (HMR overlay, slow Turbopack hydration, on-demand
// route compilation) that don't exist in shipped code. Production build is
// a one-time ~60-90s cost in exchange for deterministic runs.
//
// **Iterating locally on a spec?** Set `E2E_DEV=1` to fall back to
// `pnpm dev`. Useful when you're co-editing product code + spec and
// don't want to rebuild between each change. Don't ship CI runs in dev
// mode — that's how we got flakes mascaradas as `--retries=2`.
// Next server port.
//
// The E2E runner (scripts/e2e-with-postgres.mjs) is the SINGLE place this is
// configured: it ALWAYS sets E2E_PORT before invoking Playwright (a free port per
// run locally so a suite never collides with a dev server or another suite; the
// canonical 3005 in CI, whose job network is isolated). The fail-fast lives in
// the runner — if it can't allocate/inject the port it errors there, the one
// place you'd look. So no real test run ever reaches this config without
// E2E_PORT.
//
// This must NOT throw when E2E_PORT is absent, because static tooling (knip's
// Playwright plugin, the IDE test explorer) merely LOADS this config — it doesn't
// run the suite — and a throw there breaks spec-entry detection. Flag-style
// branch (the codebase idiom, like PW_WORKERS below), defaulting to the canonical
// dev port 3005 for that load-only context — not a value-fallback masking a
// missing required env, since the runner guarantees the value for every real run.
const PORT = process.env.E2E_PORT ? process.env.E2E_PORT : '3005'
const BASE_URL = `http://127.0.0.1:${PORT}`
// Explicit opt-in toggle (not a fallback default): `E2E_DEV=1` swaps the
// production build for `next dev`. Reading the env to branch on a flag is fine;
// what we avoid is defaulting a *value* from a missing env.
const USE_DEV_SERVER = process.env.E2E_DEV === '1'
// CI optimization knobs (read from env so the same config powers every job):
// - E2E_REUSE_BUILD=1: skip the build in webServer and `next start` the .next
//   the build stage already produced (passed as artifact) — no rebuild per shard.
// - PW_GREP: tag filter (e.g. '@smoke' locally; unset = full suite, as CI runs it).
// - PW_SHARD_TOTAL/INDEX: split the suite across N parallel CI jobs.
const REUSE_BUILD = process.env.E2E_REUSE_BUILD === '1'
const PW_GREP = process.env.PW_GREP
const PW_SHARD_TOTAL = process.env.PW_SHARD_TOTAL
const PW_JSON_REPORT = process.env.PW_JSON_REPORT

/**
 * The Next webServer env: the LOCAL Supabase stack the runner (`scripts/e2e.ts`)
 * resolved, the test-only sign-in route, and the app database URL as the
 * `oilio_app` role so RLS binds as in production.
 */
function webServerEnv(): Record<string, string> {
  const env: Record<string, string> = {
    CRON_SECRET,
    ENABLE_TEST_AUTH: 'true',
    NEXT_PUBLIC_SITE_URL: BASE_URL,
    ...(process.env.E2E_FLAGS_OFF === '1'
      ? {}
      : {
          NEXT_PUBLIC_FF_FINANCE: 'true',
          NEXT_PUBLIC_FF_COPILOT: 'true',
          NEXT_PUBLIC_FF_NOTIFICATIONS: 'true',
        }),
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
  }
  for (const key of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
  ]) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  const appDatabaseUrl = process.env.E2E_APP_DATABASE_URL
  if (appDatabaseUrl) {
    env.OILIO_DATABASE_URL = appDatabaseUrl
    env.DATABASE_URL = appDatabaseUrl
  }
  return env
}

function webServerCommand(): string {
  if (USE_DEV_SERVER) return 'pnpm run dev'
  // REUSE_BUILD: a CI shard `next start`s the .next the build stage already
  // produced (passed as artifact) instead of rebuilding.
  if (REUSE_BUILD) return `pnpm exec next start -p ${PORT}`
  return `pnpm run build && pnpm exec next start -p ${PORT}`
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  ...(PW_GREP ? { grep: new RegExp(PW_GREP) } : {}),
  ...(PW_SHARD_TOTAL
    ? { shard: { current: Number(process.env.PW_SHARD_INDEX), total: Number(PW_SHARD_TOTAL) } }
    : {}),
  // Roda 1 vez após `webServer` ficar pronto, antes do primeiro teste:
  // health do Auth local + round-trip no Postgres, pra garantir que o stack
  // Supabase está pronto. Ver `tests/e2e/helpers/global-setup.ts`.
  globalSetup: './tests/e2e/helpers/global-setup.ts',
  fullyParallel: true,
  // Worker cap — the number of parallel browser contexts PER shard.
  //
  // Each worker is a Chromium + an SSR page load (~1.5-2 GB peak RSS); unset,
  // Playwright takes ~50% of the cores it sees, which saturates small runners
  // and makes 5s asserts flake. `PW_WORKERS` sizes it to the executor; the
  // default 2 fits a GitHub-hosted runner next to the local Supabase stack.
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 2,
  forbidOnly: !!process.env.CI,
  // No automatic retries. Retries mascaram flakes — descobrir uma flake
  // tarde + duplicar CPU pra esconder. Se um teste pisca, conserta ou
  // marca explícito com `test.fail()` / `test.fixme()`. A política
  // "production build pro E2E" (webServer abaixo) elimina a fonte
  // principal de flake (hydration race do dev mode).
  retries: 0,
  // CI adds GitHub Actions annotations on failing specs; locally just the list.
  // PW_JSON_REPORT: per-spec durations the CI feeds back into duration-balanced
  // sharding (scripts/e2e-shards.ts).
  reporter: process.env.CI
    ? [
        ['list'],
        ['github'],
        ...(PW_JSON_REPORT ? [['json', { outputFile: PW_JSON_REPORT }] as const] : []),
      ]
    : 'list',
  use: {
    baseURL: BASE_URL,
    // `retain-on-failure` keeps every failing trace (vs `on-first-retry`,
    // which only captures the retry — losing the original failure when the
    // retry happens to pass). Trade-off is a bit more I/O per failure.
    trace: 'retain-on-failure',
  },
  // Single browser by default — chromium é o motor canônico (motor mais
  // instrumentado pelo nosso tooling + cobre majoritariamente o tráfego
  // alvo). Rodar firefox + webkit triplicava wall-clock sem dar sinal
  // correspondente; incidentes cross-browser viram tickets dedicados que
  // rodam o spec contra o engine relevante via `pnpm exec playwright test
  // --project=<name>` com o entry abaixo descomentado.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      // Production build by default (`next build` then `next start`).
      // `E2E_DEV=1 pnpm test:e2e` swaps in `next dev` for local iteration.
      //
      // `next dev` already pins -p 3005 in the `dev` script (per the
      // monorepo dev-port map). Don't append `-p` here — `pnpm run dev --
      // -p ${PORT}` produces `next dev -p 3005 -p 3005` and Next reads the
      // second `-p` as a positional projectDir, failing with "no such
      // directory: -p".
      command: webServerCommand(),
      url: BASE_URL,
      // A server already up was booted without the runner's env (Supabase keys,
      // test sign-in, app-role database URL), so it is never reused.
      reuseExistingServer: false,
      // Build can take 60-90s on a cold cache; bump the boot timeout so
      // the suite doesn't fail before `next start` answers.
      timeout: USE_DEV_SERVER ? 120_000 : 300_000,
      // Test secrets come from helpers/secrets.ts (the spec that signs/sends
      // uses the same constant, so values can't drift); the rest is
      // webServerEnv.
      env: webServerEnv(),
    },
  ],
})
