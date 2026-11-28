#!/usr/bin/env node
// Ephemeral-Postgres runner for the sovereign-base integration suites.
//
// Brings up the Postgres service (docker/postgres.compose.yaml), waits for it to
// be healthy, runs the Postgres-backed integration suites against the real
// database with DATABASE_URL injected, then tears the service down — pass or
// fail. Mirrors the `db:exec` pattern the Firestore apps use, but for Postgres.
// Each suite applies migrations itself, so this only owns the container lifecycle
// + the connection string.
//
// Suites (both against the same ephemeral Postgres):
//   • test:integration:product — the product base engine (A1 + A2 lookup/contrib).
//   • test:integration:pg      — the oilio registration gate (A2, 0050).
//
// Usage:  node scripts/product-it.mjs            (run both suites)
//         node scripts/product-it.mjs --keep-up  (leave Postgres running after)

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureOilioDatabase, runtimeSuiteEnv } from './oilio-pg-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const compose = path.join(root, 'docker', 'postgres.compose.yaml')

const POSTGRES_USER = 'postgres'
const POSTGRES_PASSWORD = 'postgres'
const POSTGRES_DB = 'produtos'
const POSTGRES_PORT = '5432'
const DATABASE_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`
// The oilio gate's `reconcile-products` spec reads the event-store projection
// (`public_org_directory`) on the sibling `oilio` DB — the same instance, second
// logical database. Provide its URL so the suite's globalSetup finds both.
const OILIO_DATABASE_URL = DATABASE_URL.replace(/\/produtos(\?|$)/, '/oilio$1')

const keepUp = process.argv.includes('--keep-up')

const composeEnv = {
  ...process.env,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_DB,
  POSTGRES_PORT,
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  return res.status ?? 1
}

function composeDown() {
  run('docker', ['compose', '-f', compose, 'down', '-v'], { env: composeEnv })
}

console.log('▸ subindo Postgres efêmero (docker/postgres.compose.yaml)…')
// `--wait` blocks until the healthcheck (pg_isready) passes.
const upStatus = run('docker', ['compose', '-f', compose, 'up', '-d', '--wait'], {
  env: composeEnv,
})
if (upStatus !== 0) {
  console.error('✕ Postgres não subiu.')
  composeDown()
  process.exit(upStatus)
}

let testStatus = 1
try {
  // Create the `oilio` sibling DB (idempotent) before the oilio gate suite runs.
  await ensureOilioDatabase(DATABASE_URL)
  const suiteEnv = { ...process.env, DATABASE_URL, OILIO_DATABASE_URL }
  console.log('▸ rodando a integração da base de produtos contra Postgres real…')
  const productStatus = run('pnpm', ['run', 'test:integration:product'], {
    cwd: root,
    env: suiteEnv,
  })
  console.log('▸ rodando o gate do app (test:integration:pg) contra Postgres real…')
  const oilioStatus = run('pnpm', ['run', 'test:integration:pg'], {
    cwd: root,
    env: runtimeSuiteEnv({ oilioUrl: OILIO_DATABASE_URL, productUrl: DATABASE_URL }),
  })
  // Non-zero if either suite failed; both run so a failure in one still reports
  // the other's result.
  testStatus = productStatus !== 0 ? productStatus : oilioStatus
} finally {
  if (keepUp) {
    console.log(`▸ --keep-up: Postgres segue no ar em ${DATABASE_URL}`)
  } else {
    console.log('▸ derrubando Postgres efêmero…')
    composeDown()
  }
}

process.exit(testStatus)
