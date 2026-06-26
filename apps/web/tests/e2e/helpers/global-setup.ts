// Pre-condição global da suíte E2E: garante que o stack está round-trip-ready
// pros writes-then-queries que os seeds e specs assumem — o Auth emulator
// (signup) e o event store Postgres (a única persistência pós-cutover #1202).
//
// Roda 1 vez, após `webServer` (Next) ficar pronto, antes do primeiro teste.
// Custa <500ms quando o stack tá saudável; throw com mensagem clara se não
// consistir em 30s (stack unhealthy → bug, não flake).
//
// Por que existir: o readiness do emulators:exec garante a porta do Auth
// bindada, mas o signup pode ser racy no primeiro request; e o pool do event
// store precisa estar aceitando conexões antes do primeiro seed. globalSetup
// elimina a janela.

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { AUTH_HOST } from './emulator'
import { parseJson } from './rest-json'

const API_KEY = 'fake-api-key'

const TIMEOUT_MS = 30_000
const INTERVAL_MS = 200

function curl(args: string[]): string {
  return execFileSync('curl', ['-fsS', ...args], { encoding: 'utf8' })
}

// Event store round-trip readiness: a trivial `SELECT 1` over OILIO_DATABASE_URL
// proves the `oilio` pool accepts connections before the first seed INSERTs.
async function tryEventStoreRoundtrip(): Promise<boolean> {
  if (!process.env.OILIO_DATABASE_URL) return true
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

function tryAuthSignup(): Promise<boolean> {
  const email = `warmup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  try {
    const resp = curl([
      '-X',
      'POST',
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ email, password: 'Warmup12345!', returnSecureToken: true }),
    ])
    const parsed = parseJson(
      resp,
      Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.optional(Schema.String) })),
    )
    return Promise.resolve(typeof parsed.localId === 'string' && parsed.localId.length > 0)
  } catch {
    return Promise.resolve(false)
  }
}

async function waitFor(label: string, probe: () => Promise<boolean>): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    if (await probe()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
  }
  throw new Error(`[e2e] ${label} warmup failed after ${TIMEOUT_MS}ms — emulator may be unhealthy`)
}

// Apply the sovereign-base (Postgres) migrations once, before the first spec, so
// the autofill specs (brief 0054) have the `product` table ready. Best-effort:
// when DATABASE_URL is unset the base simply isn't part of this run (a plain
// `playwright test` with no Postgres) — specs that need it set it up themselves /
// assert the best-effort degradation. Runs through the runner that owns the
// container (scripts/e2e-with-postgres.mjs / CI `services: postgres`).
async function applyProductBaseMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  const { runMigrations, closeDb } = await import('@cbrl/product')
  try {
    await runMigrations()
    // Close the migrator pool — the specs open their own through the app.
    await closeDb()
  } catch (err) {
    throw new Error(
      `[e2e] sovereign-base migrations failed (DATABASE_URL set but Postgres unreachable): ${String(err)}`,
    )
  }
}

export default async function globalSetup(): Promise<void> {
  // The base migrations are independent of the warmups — run them all
  // concurrently so the Postgres DDL roundtrip overlaps the probes instead of
  // sitting on the critical path of every shard's startup.
  await Promise.all([
    waitFor('Auth', tryAuthSignup),
    waitFor('EventStore', tryEventStoreRoundtrip),
    applyProductBaseMigrations(),
  ])
}
