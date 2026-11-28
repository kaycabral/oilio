#!/usr/bin/env node
// Postgres runner for the oilio relational integration suite — the WHOLE
// integration layer post-cutover (#1202): the event-store suite
// (`*.events.pg.integration.test.ts`) AND the product-gate suite
// (`*.pg.integration.test.ts`). After the cutover there is no Firestore-emulator
// integration test left, so `pnpm test:integration:events` routes here.
//
// Connection resolution + the docker/`oilio`-DB plumbing live in
// `oilio-pg-lib.mjs`. Three modes, by what
// Postgres is already available (see the lib for the URL rules):
//
//   • OILIO_DATABASE_URL set (CI `services:`): the `oilio` DB is reachable; just
//     ensure it exists and run the suites. No docker here.
//   • DATABASE_URL set but not OILIO (the capped test-suite container): derive
//     the `oilio` URL on the SAME instance, create the DB, run. No docker here.
//   • Neither set (bare local): bring up the ephemeral Postgres, run, tear down.
//
// Each suite applies its own migrations via globalSetup, so this runner does NOT
// migrate.
//
// Usage:  node scripts/oilio-events-it.mjs

import {
  composeDown,
  composeUp,
  ensureOilioDatabase,
  resolveConnection,
  run,
  runtimeSuiteEnv,
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

  // Both suites run the app as the `oilio_app` runtime role (OILIO_DATABASE_URL
  // for the event store, DATABASE_URL for the `produtos` base) and migrate/seed
  // as the owner (`OILIO_OWNER_DATABASE_URL`, `PRODUCT_OWNER_DATABASE_URL`).
  // `adminUrl` IS the produtos owner connection in every branch.
  const suiteEnv = runtimeSuiteEnv({ oilioUrl, productUrl: adminUrl })
  const eventsStatus = run('pnpm', ['run', 'test:integration:events:pg'], { env: suiteEnv })
  const pgStatus = run('pnpm', ['run', 'test:integration:pg'], {
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
