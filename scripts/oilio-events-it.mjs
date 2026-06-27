#!/usr/bin/env node
// Postgres runner for the oilio relational integration suite — the WHOLE
// integration layer post-cutover (#1202): the event-store suite
// (`*.events.pg.integration.test.ts`) AND the product-gate suite
// (`*.pg.integration.test.ts`). After the cutover there is no Firestore-emulator
// integration test left, so `@oilio/web run test:integration` routes here.
//
// Connection resolution + the docker/`oilio`-DB plumbing live in
// `oilio-pg-lib.mjs` (shared with the dev `db:up` path). Three modes, by what
// Postgres is already available (see the lib for the URL rules):
//
//   • OILIO_DATABASE_URL set (CI `services:`): the `oilio` DB is reachable; just
//     ensure it exists and run the suites. No docker here.
//   • DATABASE_URL set but not OILIO (the capped test-suite container): derive
//     the `oilio` URL on the SAME instance, create the DB, run. No docker here.
//   • Neither set (bare local): bring up the ephemeral Postgres, run, tear down.
//
// Each suite applies its own migrations via globalSetup (so this runner does NOT
// migrate — only the dev `db:up` path does).
//
// Usage:  node scripts/oilio-events-it.mjs

import {
  composeDown,
  composeUp,
  ensureOilioDatabase,
  resolveConnection,
  run,
  webDir,
} from './oilio-pg-lib.mjs'

const { oilioUrl, adminUrl, dbAttached } = resolveConnection()

if (!dbAttached) {
  console.log('▸ subindo Postgres efêmero para o IT do oilio (docker/postgres.compose.yaml)…')
  const upStatus = composeUp()
  if (upStatus !== 0) {
    console.error('✕ Postgres não subiu.')
    composeDown()
    process.exit(upStatus)
  }
}

let testStatus = 1
try {
  await ensureOilioDatabase(adminUrl)

  // Both suites need their URL: the event-store suite reads OILIO_DATABASE_URL,
  // the product-gate/reconcile suite reads DATABASE_URL (the `produtos` base).
  // `adminUrl` IS the produtos connection in every branch, so inject it as
  // DATABASE_URL — otherwise the bare-local path (no env URLs → ephemeral
  // container) runs the product suite with DATABASE_URL unset and it dies on
  // `requireEnv`.
  const suiteEnv = { ...process.env, OILIO_DATABASE_URL: oilioUrl, DATABASE_URL: adminUrl }
  // The full Postgres integration layer: event-store suite + product-gate suite.
  // Run both and OR the statuses so one report surfaces every failure.
  const eventsStatus = run(
    'pnpm',
    ['--filter', '@oilio/web', 'run', 'test:integration:events:pg'],
    { cwd: webDir, env: suiteEnv },
  )
  const pgStatus = run('pnpm', ['--filter', '@oilio/web', 'run', 'test:integration:pg'], {
    cwd: webDir,
    env: suiteEnv,
  })
  testStatus = eventsStatus === 0 && pgStatus === 0 ? 0 : 1
} finally {
  if (!dbAttached) {
    console.log('▸ derrubando Postgres efêmero do IT do oilio…')
    composeDown()
  }
}

process.exit(testStatus)
