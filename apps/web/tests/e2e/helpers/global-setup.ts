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

async function applyProductBaseMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  const { runMigrations, closeDb } = await import('@cbrl/product')
  try {
    await runMigrations()
    await closeDb()
  } catch (err) {
    throw new Error(
      `[e2e] sovereign-base migrations failed (DATABASE_URL set but Postgres unreachable): ${String(err)}`,
    )
  }
}

export default async function globalSetup(): Promise<void> {
  await Promise.all([
    waitFor('Auth', tryAuthSignup),
    waitFor('EventStore', tryEventStoreRoundtrip),
    applyProductBaseMigrations(),
  ])
}
