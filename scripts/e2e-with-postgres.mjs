#!/usr/bin/env node
// E2E runner for the oilio web suite WITH the sovereign product base (brief
// 0054). The autofill specs read `@cbrl/product` (Postgres) live from the form,
// so the Next server the Playwright `webServer` boots needs a `DATABASE_URL` —
// the Firestore emulator alone is not enough.
//
// Two modes, by whether DATABASE_URL is already set:
//   • LOCAL (unset): brings up the ephemeral Postgres (docker/postgres.compose
//     .yaml) — the SAME container `product-it.mjs` uses — waits for healthy,
//     injects DATABASE_URL, runs the suite, tears it down (pass or fail).
//   • CI (set): GitLab attaches Postgres via `services:` and exports
//     DATABASE_URL itself, so this just runs the suite — no docker here.
//
// The suite itself is the existing `db:exec "playwright test"` (the Firebase
// AUTH emulator wrapper). DATABASE_URL is set on the env we spawn it under, so it
// propagates to BOTH the Playwright runner (globalSetup runs migrations) and the
// Next webServer subprocess (the gate + live lookup hit the base).
//
// The oilio event store ALWAYS runs in Postgres (cutover, brief 0062 / #1202 —
// Firestore-as-database is gone): this creates the `oilio` logical database
// alongside `produtos`, applies the event-store migrations, and sets
// OILIO_DATABASE_URL so every spec exercises the typed relational projections.
//
// Usage:  node scripts/e2e-with-postgres.mjs [extra pw args…]
//         (extra args pass through to `playwright test`, e.g. a spec path)

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
const POSTGRES_DB = 'produtos'
const POSTGRES_PORT = '5432'
const LOCAL_DATABASE_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`
const LOCAL_OILIO_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/oilio`

// All args pass through to `playwright test` (e.g. a spec path). The
// event-store-in-Postgres backend is no longer optional (cutover) — it always runs.
const extraArgs = process.argv.slice(2)

// Idempotently create the `oilio` database via an admin connection. `CREATE
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
// CI provides DATABASE_URL (services: postgres). Locally we own the container.
const ciProvidedDb = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL !== ''

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  return res.status ?? 1
}

const composeEnv = { ...process.env, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT }
function composeDown() {
  run('docker', ['compose', '-f', compose, 'down', '-v'], { env: composeEnv })
}

const databaseUrl = ciProvidedDb ? process.env.DATABASE_URL : LOCAL_DATABASE_URL

if (!ciProvidedDb) {
  console.log('▸ subindo Postgres efêmero para o E2E (docker/postgres.compose.yaml)…')
  const upStatus = run('docker', ['compose', '-f', compose, 'up', '-d', '--wait'], {
    env: composeEnv,
  })
  if (upStatus !== 0) {
    console.error('✕ Postgres não subiu.')
    composeDown()
    process.exit(upStatus)
  }
} else {
  console.log('▸ DATABASE_URL já provido (CI) — usando o Postgres anexado pelo runner.')
}

// Event-store backend env — ALWAYS prepared (cutover: Postgres is the only
// backend). Derives the `oilio` URL from the provided DATABASE_URL in CI (same
// instance), or the local container otherwise; creates the DB + applies the
// event-store migrations.
const oilioUrl =
  ciProvidedDb && typeof process.env.OILIO_DATABASE_URL === 'string'
    ? process.env.OILIO_DATABASE_URL
    : LOCAL_OILIO_URL
const adminUrl = ciProvidedDb ? process.env.DATABASE_URL : LOCAL_DATABASE_URL
console.log('▸ preparando event store em Postgres (database `oilio` + migrations)…')
await ensureOilioDatabase(adminUrl)
const migrateStatus = run('pnpm', ['--filter', '@oilio/web', 'run', 'db:migrate'], {
  cwd: webDir,
  env: { ...process.env, OILIO_DATABASE_URL: oilioUrl },
})
if (migrateStatus !== 0) {
  console.error('✕ migrations do event store falharam.')
  if (!ciProvidedDb) composeDown()
  process.exit(migrateStatus)
}
const oilioEnv = { OILIO_DATABASE_URL: oilioUrl }

let testStatus = 1
try {
  // The suite runs through the existing AUTH emulator wrapper; DATABASE_URL +
  // OILIO_DATABASE_URL on the env reach both the Playwright runner and the Next
  // webServer it spawns (event store = Postgres). Forward any extra args (e.g. a
  // spec path) to `playwright test`.
  const playwright = ['db:exec', `playwright test ${extraArgs.join(' ')}`.trim()]
  testStatus = run('pnpm', ['--filter', '@oilio/web', 'run', ...playwright], {
    cwd: webDir,
    env: { ...process.env, DATABASE_URL: databaseUrl, ...oilioEnv },
  })
} finally {
  if (!ciProvidedDb) {
    console.log('▸ derrubando Postgres efêmero do E2E…')
    composeDown()
  }
}

process.exit(testStatus)
