import { defineConfig, devices } from '@playwright/test'

import { CRON_SECRET } from './tests/e2e/helpers/secrets'

// oilio/web runs on port 3005 (see CLAUDE.md "MCPs e portas dev" mapa).
// `webServer` starts the Next server only — the Firebase emulator is owned by
// `firebase emulators:exec` (the `test:e2e` script wraps Playwright in it).
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
// Canonical dev port (the `dev` script pins `next dev -p 3005` too). A plain
// constant — no env override with a fallback default.
const PORT = '3005'
const BASE_URL = `http://127.0.0.1:${PORT}`
// Explicit opt-in toggle (not a fallback default): `E2E_DEV=1` swaps the
// production build for `next dev`. Reading the env to branch on a flag is fine;
// what we avoid is defaulting a *value* from a missing env.
const USE_DEV_SERVER = process.env.E2E_DEV === '1'
// CI optimization knobs (read from env so the same config powers every job):
// - E2E_REUSE_BUILD=1: skip the build in webServer and `next start` the .next
//   the build stage already produced (passed as artifact) — no rebuild per shard.
// - PW_GREP: tag filter (e.g. '@smoke' on MR; unset = full suite on tag/nightly).
// - PW_SHARD_TOTAL/INDEX: split the suite across N parallel CI jobs.
const REUSE_BUILD = process.env.E2E_REUSE_BUILD === '1'
// E2E_STANDALONE=1: serve the production `output: 'standalone'` artifact via its
// own server.js — the EXACT entrypoint prod runs — instead of `next start`
// (which warns and isn't the standalone server). Closes the "test the artifact
// you ship" parity gap. Set by the e2e container; CI never sets it (untouched).
const STANDALONE_SERVER = process.env.E2E_STANDALONE === '1'
const PW_GREP = process.env.PW_GREP
const PW_SHARD_TOTAL = process.env.PW_SHARD_TOTAL

function webServerCommand(): string {
  if (USE_DEV_SERVER) return 'pnpm run dev'
  // STANDALONE: run the prod artifact's own server (reads PORT/HOSTNAME from env,
  // no -p flag) — identical to what Cloud Run runs.
  if (STANDALONE_SERVER) return 'node .next/standalone/apps/oilio/web/server.js'
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
  // Roda 1 vez após `webServer` ficar pronto, antes do primeiro teste.
  // Faz write→query round-trip em Firestore + signup em Auth pra
  // garantir que o stack do emulator não só tá bindado nas portas mas
  // também round-trip-ready. Ver `tests/e2e/helpers/global-setup.ts`.
  globalSetup: './tests/e2e/helpers/global-setup.ts',
  fullyParallel: true,
  // Local-only worker cap. Unset, Playwright defaults to ~50% of cores (6 on a
  // 12-core box) → 6 Chromium + 6 SSR loads exhaust RAM and freeze the desktop.
  // CI is left untouched (sharding owns parallelism there, on sized runners);
  // locally cap to a fixed 2 to keep peak RSS bounded (~1.5-2 GB per worker).
  ...(process.env.CI ? {} : { workers: 2 }),
  forbidOnly: !!process.env.CI,
  // No automatic retries. Retries mascaram flakes — descobrir uma flake
  // tarde + duplicar CPU pra esconder. Se um teste pisca, conserta ou
  // marca explícito com `test.fail()` / `test.fixme()`. A política
  // "production build pro E2E" (webServer abaixo) elimina a fonte
  // principal de flake (hydration race do dev mode).
  retries: 0,
  // CI emits JUnit (GitLab test trends + flaky detection) alongside the list
  // reporter; locally just the list. The old `github` reporter only annotated
  // GitHub Actions and is dead now that CI lives on GitLab.
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'test-results/junit.xml' }]]
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
  // The Firebase emulator is owned by `firebase emulators:exec` (the
  // `test:e2e` script wraps Playwright in it — canonical Firebase pattern).
  // The CLI injects FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
  // GCLOUD_PROJECT into this process; Playwright propagates them to the Next
  // server subprocess below, so the app's admin SDK routes to the emulator.
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
      reuseExistingServer: !process.env.CI,
      // Build can take 60-90s on a cold cache; bump the boot timeout so
      // the suite doesn't fail before `next start` answers.
      timeout: USE_DEV_SERVER ? 120_000 : 300_000,
      // Host/project come from emulators:exec (inherited env). Test secrets
      // come from helpers/secrets.ts (the spec that signs/sends uses the same
      // constant, so values can't drift). The rest are app-level test toggles.
      env: {
        CRON_SECRET,
        NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'scheduling-local',
        // Emulator-safe dummies so `isFirebaseConfigured()` (which gates
        // /api/session) passes WITHOUT a .env.local — the emulator never
        // validates these. Without them, CI (no .env.local) returned 503 from
        // /api/session and every authenticated spec failed at sign-in.
        NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-emulator',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'scheduling-local.firebaseapp.com',
        NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:demo',
        FIREBASE_ADMIN_PROJECT_ID: 'scheduling-local',
        // Origin pros invite links (team/actions.ts faz fail-fast se ausente).
        NEXT_PUBLIC_APP_URL: BASE_URL,
        // The standalone server reads PORT/HOSTNAME from env (no -p). Harmless
        // for the `next start` paths, which already bind this same port.
        PORT: String(PORT),
        HOSTNAME: '127.0.0.1',
      },
    },
  ],
})
