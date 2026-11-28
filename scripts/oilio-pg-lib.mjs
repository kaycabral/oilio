// Shared Postgres-local plumbing for the oilio relational backend (#1202).
//
// Used by the integration runners (`oilio-events-it.mjs`, `product-it.mjs`):
// up → migrate-per-suite via globalSetup → run → tear DOWN. Dev, seed and E2E
// run on the local Supabase stack instead (`pnpm db:start`).
//
// The suites isolate the event store in a logical database `oilio` next to
// `produtos` on one ephemeral Postgres (in production both share one Supabase
// database). URL resolution supports three modes:
//   • OILIO_DATABASE_URL set (CI `services:`)            → use it; admin = produtos sibling.
//   • DATABASE_URL set (capped test-suite container)     → derive oilio from produtos.
//   • neither (bare local)                               → ephemeral compose container.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '..')
export const composeFile = path.join(repoRoot, 'docker', 'postgres.compose.yaml')

const POSTGRES_USER = 'postgres'
const POSTGRES_PASSWORD = 'postgres'
// The container boots the `produtos` database; we create `oilio` alongside it.
const POSTGRES_DB = 'produtos'
const POSTGRES_PORT = '5432'
const ADMIN_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`
const LOCAL_OILIO_URL = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/oilio`

export const composeEnv = {
  ...process.env,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_DB,
  POSTGRES_PORT,
}

function nonEmptyEnv(name) {
  const value = process.env[name]
  return typeof value === 'string' && value !== '' ? value : null
}

// Resolve the `oilio` URL + the admin URL (same instance, `produtos` db) to
// create it on, plus whether WE own the docker lifecycle. OILIO set → use it;
// else derive from DATABASE_URL (produtos → oilio); else the local ephemeral
// container (which we manage). `dbAttached` is true exactly when an external
// Postgres is already provided — then the caller must NOT manage docker.
export function resolveConnection() {
  const envOilio = nonEmptyEnv('OILIO_DATABASE_URL')
  const envDatabase = nonEmptyEnv('DATABASE_URL')
  const dbAttached = envOilio !== null || envDatabase !== null
  if (envOilio !== null) {
    return {
      oilioUrl: envOilio,
      adminUrl: envOilio.replace(/\/oilio(\?|$)/, '/produtos$1'),
      dbAttached,
    }
  }
  if (envDatabase !== null) {
    return {
      oilioUrl: envDatabase.replace(/\/produtos(\?|$)/, '/oilio$1'),
      adminUrl: envDatabase,
      dbAttached,
    }
  }
  return { oilioUrl: LOCAL_OILIO_URL, adminUrl: ADMIN_URL, dbAttached }
}

// The suites connect the code under test as the `oilio_app` runtime role (no
// BYPASSRLS, not the owner), exactly as production does; the owner URLs only
// migrate and seed fixtures. The password is local to the ephemeral Postgres;
// the suites' globalSetup gives the NOLOGIN role this login.
export const RUNTIME_ROLE = 'oilio_app'
const RUNTIME_ROLE_PASSWORD = 'oilio_app_test_only'

export function withRuntimeRole(url) {
  const runtime = new URL(url)
  runtime.username = RUNTIME_ROLE
  runtime.password = RUNTIME_ROLE_PASSWORD
  return runtime.toString()
}

// Env for the suites that exercise the app (`test:integration:events:pg`,
// `test:integration:pg`): owner URLs for migrations/fixtures, runtime-role URLs
// for everything the app itself opens.
export function runtimeSuiteEnv({ oilioUrl, productUrl }) {
  return {
    ...process.env,
    OILIO_OWNER_DATABASE_URL: oilioUrl,
    PRODUCT_OWNER_DATABASE_URL: productUrl,
    OILIO_DATABASE_URL: withRuntimeRole(oilioUrl),
    DATABASE_URL: withRuntimeRole(productUrl),
  }
}

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  return res.status ?? 1
}

// Bring the ephemeral Postgres up and block until it is query-ready (`--wait`
// honours the compose healthcheck). Returns the exit status.
//
// Gotcha it guards: a `docker-postgres-1` left running by a SIBLING compose that
// does NOT publish the port (the capped test battery runs Postgres container-
// internal) is REUSED by a plain `up` — healthy, but `5432/tcp` is unmapped, so
// the host gets ECONNREFUSED. `--wait` passes (the container IS healthy) and the
// missing host port only surfaces later, deep in the seed. So after `up` we
// probe the host port; if it's unreachable we force-recreate THIS compose's
// service (which carries the `5432:5432` mapping). Safe for dev: the seed resets
// the DB anyway, and the prod/CI paths set OILIO_DATABASE_URL (dbAttached) and
// never call this.
export function composeUp() {
  const status = run('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait'], {
    env: composeEnv,
  })
  if (status !== 0) return status
  if (hostPortReachable('127.0.0.1', Number(POSTGRES_PORT))) return 0
  // Reused an unmapped sibling container — recreate with this file's port mapping.
  return run('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait', '--force-recreate'], {
    env: composeEnv,
  })
}

// Best-effort TCP probe of a host:port (the published Postgres mapping). Uses a
// short-lived socket so we don't pull in a pg client just to check reachability.
function hostPortReachable(host, port) {
  const res = spawnSync(
    'node',
    [
      '-e',
      `const s=require('net').connect(${port},'${host}');s.setTimeout(1500);` +
        `s.on('connect',()=>{s.destroy();process.exit(0)});` +
        `s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));`,
    ],
    { stdio: 'ignore' },
  )
  return res.status === 0
}

export function composeDown() {
  return run('docker', ['compose', '-f', composeFile, 'down', '-v'], { env: composeEnv })
}

// Idempotently create the `oilio` database via the admin connection. `CREATE
// DATABASE` cannot run inside a transaction; a duplicate (42P04) is a no-op.
export async function ensureOilioDatabase(adminUrl) {
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
