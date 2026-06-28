#!/usr/bin/env node
// E2E runner for the oilio web suite WITH the sovereign product base (brief
// 0054). The autofill specs read `@cbrl/product` (Postgres) live from the form,
// so the Next server the Playwright `webServer` boots needs a `DATABASE_URL` —
// the Firestore emulator alone is not enough.
//
// Two modes, by whether DATABASE_URL is already set:
//   • LOCAL (unset): brings up an ISOLATED ephemeral Postgres (docker/postgres
//     .compose.yaml under a per-run compose project, on a FREE port), waits for
//     healthy, injects DATABASE_URL, runs the suite, tears it down (pass or
//     fail). Fully namespaced so it never collides with — or writes to — the
//     developer's own dev stack on the same host (see the isolation block below).
//   • CI (set): GitLab attaches Postgres via `services:` and exports
//     DATABASE_URL itself, so this just runs the suite — no docker here. Each CI
//     job already has its own isolated network, so CI keeps the fixed ports.
//
// The suite runs inside the Firebase AUTH emulator (emulators:exec); DATABASE_URL
// + OILIO_DATABASE_URL + E2E_PORT are set on the env we spawn it under, so they
// propagate to BOTH the Playwright runner (globalSetup runs migrations) and the
// Next webServer subprocess (the gate + live lookup hit the base).
//
// The oilio event store ALWAYS runs in Postgres (cutover, brief 0062 / #1202 —
// Firestore-as-database is gone): this creates the event-store database
// (run-scoped `oilio_e2e_<run>` locally; `oilio` in CI) alongside `produtos`,
// applies the event-store migrations, and sets OILIO_DATABASE_URL so every spec
// exercises the typed relational projections.
//
// Usage:  node scripts/e2e-with-postgres.mjs [extra pw args…]
//         (extra args pass through to `playwright test`, e.g. a spec path)

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const compose = path.join(root, 'docker', 'postgres.compose.yaml')
const webDir = path.join(root, 'apps', 'oilio', 'web')
const oilioDir = path.join(root, 'apps', 'oilio')

// CI provides DATABASE_URL (services: postgres) and runs each job in its own
// isolated network — no host to collide with. Locally, we own everything AND
// must never collide with the developer's own dev stack (emulator on 9099,
// Postgres on 5432) running on the SAME host. So every LOCAL run is fully
// namespaced: a free OS-allocated port for each service, a dedicated compose
// project, and a throwaway database — nothing fixed to clash with.
const ciProvidedDb = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL !== ''

// Allocate a free TCP port from the OS (bind :0, read it back, release). Racy in
// theory (the port is free again until the service binds it), but the window is
// milliseconds and each service binds immediately — far safer than a fixed port
// that's GUARANTEED to clash with a dev stack on the same host.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// A short, unique-enough run id to namespace the compose project + database. No
// Math.random/Date in app code, but this is a build script — pid+hrtime is fine.
const runId = `${process.pid}${process.hrtime.bigint().toString(36).slice(-4)}`

const POSTGRES_USER = 'postgres'
const POSTGRES_PASSWORD = 'postgres'
const POSTGRES_DB = 'produtos'
// Local: a free port + namespaced compose project + throwaway oilio DB, so a
// concurrent dev Postgres (or another E2E run) on the same host can't collide.
const POSTGRES_PORT = ciProvidedDb ? '5432' : String(await freePort())
const COMPOSE_PROJECT = `oilio-e2e-${runId}`
const OILIO_DB = ciProvidedDb ? 'oilio' : `oilio_e2e_${runId}`
const LOCAL_DATABASE_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`
const LOCAL_OILIO_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${OILIO_DB}`

// All args pass through to `playwright test` (e.g. a spec path). The
// event-store-in-Postgres backend is no longer optional (cutover) — it always runs.
const extraArgs = process.argv.slice(2)

// Idempotently create the event-store database via an admin connection. `CREATE
// DATABASE` cannot run inside a transaction; a duplicate (42P04) is a no-op.
async function ensureOilioDatabase(adminUrl, dbName) {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE ${dbName}`)
  } catch (err) {
    if (err.code !== '42P04') throw err
  } finally {
    await client.end()
  }
}
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  return res.status ?? 1
}

// Namespaced compose project (`-p`) so the dev Postgres container and any other
// E2E run get their OWN container/network — `down` only tears down THIS run's.
const composeEnv = { ...process.env, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT }
const composeArgs = ['compose', '-p', COMPOSE_PROJECT, '-f', compose]
function composeDown() {
  run('docker', [...composeArgs, 'down', '-v'], { env: composeEnv })
}

const databaseUrl = ciProvidedDb ? process.env.DATABASE_URL : LOCAL_DATABASE_URL

if (!ciProvidedDb) {
  console.log(
    `▸ subindo Postgres efêmero isolado (projeto ${COMPOSE_PROJECT}, porta ${POSTGRES_PORT})…`,
  )
  const upStatus = run('docker', [...composeArgs, 'up', '-d', '--wait'], { env: composeEnv })
  if (upStatus !== 0) {
    console.error('✕ Postgres não subiu.')
    composeDown()
    process.exit(upStatus)
  }
} else {
  console.log('▸ DATABASE_URL já provido (CI) — usando o Postgres anexado pelo runner.')
}

// Event-store backend env — ALWAYS prepared (cutover: Postgres is the only
// backend). Derives the oilio URL from the provided DATABASE_URL in CI (same
// instance), or the local container otherwise; creates the DB + applies the
// event-store migrations. Locally the DB name is run-scoped (oilio_e2e_<run>) so
// it never touches the developer's own `oilio` database.
const oilioUrl =
  ciProvidedDb && typeof process.env.OILIO_DATABASE_URL === 'string'
    ? process.env.OILIO_DATABASE_URL
    : LOCAL_OILIO_URL
const adminUrl = ciProvidedDb ? process.env.DATABASE_URL : LOCAL_DATABASE_URL
console.log(`▸ preparando event store em Postgres (database \`${OILIO_DB}\` + migrations)…`)
await ensureOilioDatabase(adminUrl, OILIO_DB)
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

// LOCAL ISOLATION: allocate a free auth-emulator port + a free Next port, and
// write an EPHEMERAL firebase config pinned to that auth port. The Firebase CLI
// can't read a port from env, so the config must be materialized per run. CI
// keeps the committed config (its job network is already isolated). Without this,
// the E2E auth emulator (9099) and Next (3005) collide with the developer's dev
// stack on the same host.
// E2E_PORT is the single source of truth for the Next port — the runner is the
// one place it's configured, so playwright.config.ts can `requireEnv('E2E_PORT')`
// and fail loud if it's ever missing, instead of defaulting a value somewhere
// downstream. CI keeps the canonical 3005 (its job network is isolated); locally
// it's a free port (below) so it never collides with the dev server on the host.
let emulatorConfig = path.join(oilioDir, 'firebase.json')
let nextPortEnv = { E2E_PORT: '3005' }
let tmpConfig = null
if (!ciProvidedDb) {
  const authPort = await freePort()
  const nextPort = await freePort()
  // The Firebase CLI can't read a port from env, so the auth port must be
  // materialized into a config file. Write an EPHEMERAL one per run pinned to the
  // free auth port; CI keeps the committed firebase.json (its network is isolated).
  tmpConfig = path.join(oilioDir, `.firebase.e2e-${runId}.json`)
  fs.writeFileSync(
    tmpConfig,
    JSON.stringify(
      {
        emulators: {
          auth: { port: authPort, host: '127.0.0.1' },
          ui: { enabled: false },
          singleProjectMode: true,
        },
      },
      null,
      2,
    ),
  )
  emulatorConfig = tmpConfig
  nextPortEnv = { E2E_PORT: String(nextPort) }
  console.log(`▸ emulador auth em :${authPort}, Next em :${nextPort} (isolado do dev stack)`)
}

function cleanup() {
  if (ciProvidedDb) return
  if (tmpConfig) fs.rmSync(tmpConfig, { force: true })
  console.log('▸ derrubando Postgres efêmero do E2E…')
  composeDown()
}

let testStatus = 1
try {
  // Run Playwright INSIDE the auth emulator (emulators:exec injects
  // FIREBASE_AUTH_EMULATOR_HOST, which Playwright propagates to the Next
  // subprocess). DATABASE_URL + OILIO_DATABASE_URL + E2E_PORT on the env reach
  // both the runner and the webServer. Invoked directly (not via the db:exec
  // script) so the ephemeral, per-run config + dynamic port apply locally.
  const pwCmd = `pnpm exec playwright test ${extraArgs.join(' ')}`.trim()
  testStatus = run(
    'npx',
    [
      '-y',
      'firebase-tools',
      'emulators:exec',
      '--only',
      'auth',
      '--project',
      'scheduling-local',
      '--config',
      emulatorConfig,
      pwCmd,
    ],
    {
      cwd: webDir,
      env: { ...process.env, DATABASE_URL: databaseUrl, ...oilioEnv, ...nextPortEnv },
    },
  )
} finally {
  cleanup()
}

process.exit(testStatus)
