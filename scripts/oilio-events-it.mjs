#!/usr/bin/env node
// Postgres runner for the oilio relational integration suite — the WHOLE
// integration layer post-cutover (#1202): the event-store suite
// (`*.events.pg.integration.test.ts`) AND the product-gate suite
// (`*.pg.integration.test.ts`). After the cutover there is no Firestore-emulator
// integration test left, so `@oilio/web run test:integration` routes here.
//
// The event store lives in a SEPARATE logical database `oilio` on the same
// instance as the sovereign base `produtos` (PRD: "1 instância, 2 databases
// lógicos"). Three modes, by what Postgres is already available:
//
//   • OILIO_DATABASE_URL set (CI `services:`): the `oilio` DB is reachable; just
//     ensure it exists and run the suites. No docker here.
//   • DATABASE_URL set but not OILIO (the capped test-suite container, which
//     attaches the compose `postgres` as `produtos`): derive the `oilio` URL on
//     the SAME instance, create the DB, run the suites. No docker here.
//   • Neither set (bare local): bring up the ephemeral Postgres
//     (docker/postgres.compose.yaml), create `oilio`, run, tear down.
//
// Each suite applies its own migrations via globalSetup.
//
// Usage:  node scripts/oilio-events-it.mjs

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const compose = path.join(root, 'docker', 'postgres.compose.yaml')
const webDir = path.join(root, 'apps', 'oilio', 'web')

const POSTGRES_USER = 'postgres'
const POSTGRES_PASSWORD = 'postgres'
// The container boots the `produtos` database; we create `oilio` alongside it.
const POSTGRES_DB = 'produtos'
const POSTGRES_PORT = '5432'
const ADMIN_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`
const LOCAL_OILIO_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/oilio`

const envOilio =
  typeof process.env.OILIO_DATABASE_URL === 'string' && process.env.OILIO_DATABASE_URL !== ''
    ? process.env.OILIO_DATABASE_URL
    : null
// The capped test-suite container attaches the compose `postgres` as
// `produtos` via DATABASE_URL — derive the `oilio` URL on the same instance.
const envDatabase =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL !== ''
    ? process.env.DATABASE_URL
    : null
// A Postgres is already attached (CI services / the test-suite container) when
// either URL is set — in that case we DON'T manage our own docker.
const dbAttached = envOilio !== null || envDatabase !== null

const composeEnv = { ...process.env, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT }

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  return res.status ?? 1
}

function composeDown() {
  run('docker', ['compose', '-f', compose, 'down', '-v'], { env: composeEnv })
}

// Idempotently create the `oilio` database via the admin connection. `CREATE
// DATABASE` cannot run inside a transaction; a duplicate (42P04) is a no-op.
async function ensureOilioDatabase(adminUrl) {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try {
    await client.query('CREATE DATABASE oilio')
  } catch (err) {
    if (err.code !== '42P04') throw err
  } finally {
    await client.end()
  }
}

// Resolve the `oilio` URL + the admin URL (same instance, `produtos` db) to
// create it on. OILIO set → use it; else derive from DATABASE_URL (produtos →
// oilio); else the local ephemeral container.
let oilioUrl
let adminUrl
if (envOilio !== null) {
  oilioUrl = envOilio
  adminUrl = envOilio.replace(/\/oilio(\?|$)/, '/produtos$1')
} else if (envDatabase !== null) {
  oilioUrl = envDatabase.replace(/\/produtos(\?|$)/, '/oilio$1')
  adminUrl = envDatabase
} else {
  oilioUrl = LOCAL_OILIO_URL
  adminUrl = ADMIN_URL
}

if (!dbAttached) {
  console.log('▸ subindo Postgres efêmero para o IT do oilio (docker/postgres.compose.yaml)…')
  const upStatus = run('docker', ['compose', '-f', compose, 'up', '-d', '--wait'], {
    env: composeEnv,
  })
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
